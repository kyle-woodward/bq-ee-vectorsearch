/*
BigQuery Vector Search 
Author: kyle woodward
Last modified: July 10, 2025
*/

/*
Data & Layers
*/

// Data

// AOI
var aoi = ee.FeatureCollection("projects/g4g-eaas/assets/earthgenome_kenya_subset36_v1_AOI")

var country = ee.FeatureCollection("FAO/GAUL/2015/level0")
.filterMetadata('ADM0_NAME',"equals",'Kenya')


// S2 Annual Ref Img
function buildS2(aoi,sd,ed){
  function maskS2clouds(image) {
  var qa = image.select('QA60');

  // Bits 10 and 11 are clouds and cirrus, respectively.
  var cloudBitMask = 1 << 10;
  var cirrusBitMask = 1 << 11;

  // Both flags should be set to zero, indicating clear conditions.
  var mask = qa.bitwiseAnd(cloudBitMask).eq(0)
      .and(qa.bitwiseAnd(cirrusBitMask).eq(0));

  return image.updateMask(mask).divide(10000);
}

var dataset = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
                  .filterDate(sd, ed)
                  // Pre-filter to get less cloudy granules.
                  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE',20))
                  .map(maskS2clouds);
var img = dataset.median()
return img
}


var d = {'aoi':aoi,
          'country':country,
          'img':buildS2(aoi,'2024-01-01','2024-12-31')
}

// Layers
var l = {}

l.aoi = ui.Map.Layer({
  eeObject:d.aoi.style({'color':'red','fillColor':'00000000'}),
  name:'Vector Search Coverage',
})

l.country = ui.Map.Layer({
  eeObject:d.country.style({'color':'black','fillColor':'00000000'}),
  name:'Kenya',
})

l.img = ui.Map.Layer({
  eeObject:d.img,
  visParams:{
  min: 0.0,
  max: 0.3,
  bands: ['B4', 'B3', 'B2'],
  },
  name:'Sentinel-2 2024',
  shown:true,
})

  
/////////End Data & Layers /////////////////////

/*

Behaviors

*/

var b = {}

b.nextPoint = function(pt){
  var point = ee.Geometry.Point(pt.lon,pt.lat)
  var layer = ui.Map.Layer({
  eeObject:point,
  visParams:{color:'yellow'},
  name:'Clicked Point',
  shown:true,
  opacity:1,})
  Map.layers().reset()  
  Map.layers().insert(1,l.aoi)
  Map.layers().insert(2,l.img)
  Map.layers().insert(3,layer)
  Map.centerObject(point,16)
}

Map.onClick(b.nextPoint)

b.updateSlider = function(c){
  var v = c
  return v
}


b.runSearch = function runSearch(){
  var clicked = Map.layers().get(2)
  var pt = Map.layers().get(2).get("eeObject").geometry().coordinates().getInfo()
  if(Map.layers().get(2).getName()!= "Clicked Point"){
    c.w = ui.Label("Hey")
    c.warning = ui.Panel([ui.Label("Please Click the Map")], 
    ui.Panel.Layout.Flow('vertical'), { 
    // backgroundColor: '#00000000', 
    // color: '00000000',
    position: 'top-center'});
    print("Click on the map first..")
    return
  }
  else{
  
  // construct BQ VECTOR_SEARCH query, injecting pt lat and lon
  var matches = c.matchesSlider.getValue()
  var topk = matches+1 // the first match is itself 
  
  var bqTable = "embeddings_kenya.earthgenome_kenya_subset36_v1"
  var EGquery = 
  "SELECT\n"+
    "base.id as base_id,\n"+
    "base.tile as base_tile,\n"+
    "query.id as query_id,\n"+
    "query.tile as query_tile,\n"+
    "base.geometry as geo,\n"+
    "distance\n"+
  "FROM\n"+
    "VECTOR_SEARCH(\n"+
      "TABLE " + bqTable + ",\n "+
      "'embedding',\n"+
      "(SELECT id, tile, embedding \n"+
      "FROM " + bqTable + "\n"+
      "WHERE ST_DWITHIN(geometry, ST_GEOGPOINT("+pt[0]+","+pt[1]+"),160)\n"+
      "LIMIT 1),\n"+
      "'embedding',\n"+
      "top_k => "+topk+")\n"+
  "LIMIT "+matches+"\n"+
  "OFFSET 1;\n"
  print(EGquery)
  var EGsearchResult = ee.FeatureCollection.runBigQuery(EGquery)
  .map(function (f){return f.setGeometry(f.geometry().buffer(160).bounds())})
  print(EGsearchResult)
  print("ids",EGsearchResult.aggregate_array('base_id'))
  print("tiles",EGsearchResult.aggregate_array('base_tile'))
  print("distance",EGsearchResult.aggregate_array('distance'))
  print("distance unique",EGsearchResult.aggregate_array('distance').distinct())
  
  var EGresultLayer = ui.Map.Layer({
  eeObject:EGsearchResult.style({'color':'red','fillColor':'00000000'}),
  visParams:{color:'red'},
  name:'EG Similar Areas',
  shown:true,
  opacity:1,})
  
  Map.layers().reset()
  Map.layers().insert(1,l.aoi)
  Map.layers().insert(2,l.img)
  Map.layers().insert(4,EGresultLayer)
  Map.layers().insert(5,clicked)
  Map.centerObject(EGsearchResult.limit(1,'distance',true).first(),14)
  
}}

////////END Behaviors//////////

/* 
Styles
*/
var s = {}

// component styles
s.panelLeft = {width: '400px'};
s.titleLabel = {fontSize: '22px', fontWeight: 'bold'};
s.layerPanel = {border: '1px solid black', margin: '5px 5px 0px 5px'};
s.layerPanelName = {fontWeight: 'bold'};
s.layerPanelDescription = {color: 'grey', fontSize: '11px'};
s.matchesLabel = {color:'red',fontSize:'11px'}
s.controlPanel = {border: '1px dotted grey', margin: '5px 5px 0px 5px'}
s.runButton = {color:'red'}

/////////END Styles/////////////

/*
Components
*/

var c = {};

// title
c.titlePanel = ui.Label('Vector Search',s.titleLabel)
c.infoPanel = ui.Label('To get started, click on the map, adjust how many matches to return below, click the button!',s.layerPanelDescription)

// controls
c.matchesLabel = ui.Label('Matches',s.matchesLabel)
c.matchesSlider = ui.Slider(0,100,10,10,b.updateSlider,'horizontal',false)
c.matchesPanel = ui.Panel([c.matchesLabel,c.matchesSlider],ui.Panel.Layout.flow("horizontal"),s.layerPanel)
c.runButton = ui.Button('Run Vector Search',b.runSearch,false,s.runButton)


// finished panels
c.titlePanel = ui.Panel([c.titlePanel,c.infoPanel])
c.controlPanel = ui.Panel([c.matchesPanel,c.runButton],ui.Panel.Layout.flow("horizontal"),s.controlPanel)

c.buildUI = function() { 
  var panelLeft = ui.Panel([
      c.titlePanel,
      c.controlPanel,
    ],
    ui.Panel.Layout.flow('vertical'),
    s.panelLeft
  );
  ui.root.widgets().insert(0, panelLeft);
};

//////////END Components/////////////




// Initialize
var App = {}


App.setupMap = function() {
  var visualization = {
  min: 0.0,
  max: 0.3,
  bands: ['B4', 'B3', 'B2'],
};


  Map.setOptions('SATELLITE');
  Map.style().set({ cursor: 'crosshair' });
  Map.centerObject(d.aoi,6)
  Map.layers().insert(0,l.country)
  Map.layers().insert(1,l.aoi)
  Map.layers().insert(2,l.img)
};

App.run = function() {
  App.setupMap();
  c.buildUI();
};

App.run();