require('dotenv').config();
const vtpbf = require('vt-pbf');
const geojsonVt = require('geojson-vt');
const express = require('express');
const cors = require('cors');
const tilebelt = require('@mapbox/tilebelt');
const compression = require('compression');

function tileToQuadkeyCompress (tile) {
    function bits(n, b = 32) { // n = number, b = number of bits to extract
        return [...Array(b)].map((val, idx, arr) => (n >> arr.length - idx - 1) & 1);
    }
    let bitmap = [];
    for (let z = tile[2]; z > 0; z--) {
        // apply the mask as per the original algorithm
        let digit = 0;
        let mask = 1 << (z - 1);
        if ((tile[0] & mask) !== 0) digit = 1;
        if ((tile[1] & mask) !== 0) digit += 2;
        // add only the desired 2 bits to the bit map
        bitmap = bitmap.concat(bits(digit, 2));
    }
    // creates an integer based on the obtained bitmap and append the size (for decompression)
    return bitmap.reduce((res, val, idx) => res + val * 2 ** idx) * 100 + tile[2];
}

const GRIDZOOM = 21;  // Zoom level that the grid itself exists at
const MAXZOOM = 14;   // Maximum level we will generate and serve vector tiles for
const MINZOOM = 14;   // Minimum level we will generate and serve vector tiles for

// Returns a feature collection of all the grid cells within this tile, if we're zoomed close enough.
function getGridGeometry(tile) {
    const tiles = [];
    function getSubTiles(tile) {
        if (tile[2] >= GRIDZOOM) {
            tiles.push(tile);
        } else {
            tilebelt.getChildren(tile).map(getSubTiles);
        }
    }
    if (tile[2] >= MINZOOM) {
        getSubTiles(tile);
    }
    const tileGeoms = tiles.map(tile => ({
        type: 'Feature',
        properties: {},
        geometry: tilebelt.tileToGeoJSON(tile),
        id: tileToQuadkeyCompress(tile)
    }));
    console.log (`${tile} => ${tileGeoms.length} grid cells`);
    return {
        type: 'FeatureCollection',
        features: tileGeoms
    };
}

const app = express();
app.use(cors());
app.use(compression()); // doesn't seem to work on pbf?

app.get('/grid/:z/:x/:y.:format', (req, res) => {
    const p = req.params;
    const [x, y, z] = [+req.params.x, +req.params.y, +req.params.z];
    if (z < MINZOOM) {
        return res.status(404).end();
    }
    // generate the geometry spanning the required area
    const gridGeometry = getGridGeometry([x, y, z]);
    // convert it into vector tiles
    const gridTiles = geojsonVt(gridGeometry, {
        maxZoom: z,
        indexMaxZoom: z
    });
    
    // select the one vector tile actually requested
    const requestedTile = gridTiles.getTile(z, x, y);
    if (!requestedTile) {
        return res.status(404).end();
    }

    if (req.params.format === 'pbf') {
        // turn it into a PBF
        const buff = vtpbf.fromGeojsonVt({ grid: requestedTile }); // "grid" is the layer name
        
        // send it back
        res.type('application/vnd.mapbox-vector-tile')
            .send(Buffer.from(buff))
            .end();
    } else if (req.params.format === 'json') {
        res.send(requestedTile);
    } else {
        res.status(400);
    }
    
});

const listener = app.listen(process.env.PORT, function() {
    // test URL /grid/18/236602/160844.json
    console.log('Running grid server on port ' + listener.address().port);
});
  