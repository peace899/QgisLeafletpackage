function getlayersBounds() {
    db = geoPackage.connection.getDBConnection()    
    minXY = db.prepare('select min(min_y), min(min_x) from gpkg_contents').getAsObject({$})
    maxXY = db.prepare('select max(max_y), max(max_x) from gpkg_contents').getAsObject({$})
    
    bounds = [Object.values(minXY), Object.values(maxXY)]
    map.fitBounds(bounds)
}

function addVectorLayer(layerName) {
    console.log(`adding ${layerName}`)
    layerObject = findByLabel(layerTree, layerName);
    propKey = layerObject.propKey;
    qml = stylesData.filter(a => a.styleName == layerName)[0].styleQML
    qmlStyler = new styleQMLParser(qml);

    if (qmlStyler.fillPatternOptions) {
        qmlStyler.styles = getPatternedStyles(qmlStyler.fillPatternOptions, qmlStyler.styles)
    }

    iter = geoPackage.getFeatureDao(layerName).queryForGeoJSONIndexedFeaturesWithBoundingBox(
        undefined,
        true);

    if (layerObject.renderType == 'singleSymbol') {
        var vectorLayer = L.geoJSON(null, 
            {
                style: qmlStyler.styles[0],
                pointToLayer: function(feature, latlng) {
                    return createPointLayer(latlng, qmlStyler.markerLayerOptions[0])
                },
                onEachFeature: function (feature, layer) {
                    layer.on({
                        click: showFeatureProperties
                    });
                }
            });
        

        for (const feature of iter) {
            feature.type = 'Feature'
            props = {}
            props['layerName'] = layerName
            props['fid'] = feature.id
            feature.properties = props
            //copy valid geometry feature

            try {
                vectorLayer.addData(feature);
            } catch (error) {
                continue;
            }
        }
        layerObject.label = `<span class="leaflet-layerstree-header-name" id="${layerObject.id}">${layerName}</span>`
        layerObject['layer'] = vectorLayer;
    }

    if (layerObject.renderType == 'categorizedSymbol') {
        categorizedLayers = layerObject.children

        categorizedLayers.forEach(obj => {
            layer = L.geoJSON(null, 
                {
                    style: qmlStyler.styles[obj.label],
                    pointToLayer: function(feature, latlng) {
                        return createPointLayer(latlng, qmlStyler.markerLayerOptions[obj.label])
                    },
                    onEachFeature: function (feature, layer) {
                        layer.on({
                            click: showFeatureProperties
                        });
                    }
                });
            obj['layer'] = layer;

        });

        for (const feature of iter) {
            feature.type = 'Feature'
            categoryValue = feature.properties[propKey];
            //Counter shapefiles 10 character limit on attributes
            if (!categoryValue) {                
                propKey = propKey.slice(0, 10)
                categoryValue = feature.properties[propKey];
            }
            
            index = categorizedLayers.findIndex(obj => obj.label === categoryValue);

            if (index !== -1) {
                layer = categorizedLayers[index]['layer'];
                props = {}
                props['layerName'] = layerName
                props['fid'] = feature.id
                feature.properties = props
                //copy valid geometry features
                if (feature.geometry !== null) {
                    layer.addData(feature);
                }
            }
        }
        categorizedLayers.forEach(obj => {
            obj.label = `<span class="leaflet-layerstree-header-name" id="${obj.id}">${obj.label}</span>`
        })        
    }


    if (layerObject.renderType == 'graduatedSymbol') {
        graduatedLayers = layerObject.children

        graduatedLayers.forEach(obj => {
            layer = L.geoJSON(null, 
                {
                    style: qmlStyler.styles[obj.label],
                    pointToLayer: function(feature, latlng) {
                        return createPointLayer(latlng, qmlStyler.markerLayerOptions[obj.label])
                    },
                    onEachFeature: function (feature, layer) {
                        layer.on({
                            click: showFeatureProperties
                        });
                    }
                });
            obj['layer'] = layer          
        });

        for (const feature of iter) {
            feature.type = 'Feature';

            rangeValue = feature.properties[propKey];
            if (!rangeValue) {
                // If original layer source is from a shapefile, attributes normally are limited to 10 characters
                propKey = propKey.slice(0, 10)
                rangeValue = feature.properties[propKey];
            }
            index = graduatedLayers.findIndex(v => rangeValue >= v.range[0] && rangeValue <= v.range[1]);

            if (index !== -1) {
                layer = graduatedLayers[index]['layer'];
                props = {}
                props['layerName'] = layerName
                props['fid'] = feature.id
                feature.properties = props
                //copy valid geometry features
                if (feature.geometry !== null) {
                    layer.addData(feature);
                }
            }
        }

        graduatedLayers.forEach(obj => {
            obj.label = `<span class="leaflet-layerstree-header-name" id="${obj.id}">${obj.label}</span>`
        })        
    }
}

function createPointLayer(latlng, markerLayerOptions){
    
    if (markerLayerOptions.name === 'circle') {
        return new L.CircleMarker(latlng, {
        	radius: parseFloat(markerLayerOptions.size) / 2, 
        	fillOpacity: colorAndOpacity(markerLayerOptions.color)[1], 
            fillColor: colorAndOpacity(markerLayerOptions.color)[0],
            color: colorAndOpacity(markerLayerOptions.outline_color)[0],
            opacity: colorAndOpacity(markerLayerOptions.outline_color)[1]
        })
    } else {
        return L.shapeMarker(latlng, { 
            radius: parseFloat(markerLayerOptions.size), 
        	fillOpacity: colorAndOpacity(markerLayerOptions.color)[1], 
            fillColor: colorAndOpacity(markerLayerOptions.color)[0],
            color: colorAndOpacity(markerLayerOptions.outline_color)[0],
            opacity: colorAndOpacity(markerLayerOptions.outline_color)[1],
            shape: markerLayerOptions.name
        })
    }
    

}

function addWMSLayer(layerName) {
    console.log(`adding ${layerName}`)
    layerObject = findByLabel(layerTree, layerName);
    layerObject.label = `&#x1f5fa; ${layerName}`
    url = layerObject.params.url
    minZoom = layerObject.params.zmin
    maxZoom = layerObject.params.zmax
    layer = L.tileLayer(url, { minZoom: minZoom, maxZoom: maxZoom })
    layerObject['layer'] = layer;

}

function getPatternedStyles(patternOptions, styles) {
    
    Object.keys(patternOptions).forEach((key) => {
        patternOption = patternOptions[key];
        if (patternOption.patternType==='LinePatternFill'){
            pattern = new L.StripePattern({                
                // weight: parseFloat(patternOption.line_width),                
                weight: 1,
                spaceWeight: patternOption.distance,
                color: colorAndOpacity(patternOption.color)[0],
                opacity: 1,
                spaceOpacity: 0,
                angle: 360 - parseInt(patternOption.angle)

            })
            pattern.addTo(map)
            styles[key]['fillPattern'] = pattern
        }

        if (patternOption.patternType === 'PointPatternFill') {
            options = {}


        }


    })
    
return styles    
}

function adjustTreeStyle() {
    //layerControl = L.control.layers.tree({}, layerTree, { collapsed: false, spaceSymbol: "   " }).addTo(map);
    selectors = [...$('.leaflet-control-layers-selector')]
    lastchildren = selectors.filter(a => a.className.split(' ').length == 1)
    lastchildren.map(el => el.parentElement.style.marginLeft = '12px')
    addPreviewIcons()
    
    // $('span.leaflet-layerstree-header-name').filter(function(){
    //     return $(this).text().trim() === 'GOU Border Zone';
    // })[0]
    // var img = $('<img id="dynamic">')
    // img.attr('src', "data:image/png;base64, " + btoa(String.fromCharCode.apply(null, ba)))
    // img.prependTo(el)
}

function addLayerTree() {
    layerControl = L.control.layers.tree({}, layerTree, { collapsed: false, spaceSymbol: "   " }).addTo(map);
    selectors = [...$('.leaflet-control-layers-selector')]
    lastchildren = selectors.filter(a => a.className.split(' ').length == 1)
    lastchildren.map(el => el.parentElement.style.marginLeft = '12px')
    addPreviewIcons()
    $('#loading').hide();
}

function addPreviewIcons() { 
    symbolPreviews = geoPackage.getAttributeDao('symbol_pixmaps').queryForAll();
    symbolPreviews.forEach(obj => {
        id = obj['symbol_id'];
        imageBase64 = obj.content
        element = $(`#${id}`)
        element.text(function(i,v) {
            return " " + v;
        });        
        var img = $('<img class="symbol" width="13" height="13">')
        img.attr('src', "data:image/png;base64," + imageBase64)
        img.prependTo(element)        
    })
}

function showFeatureProperties(e) {
    
    layerName = e.target.feature.properties.layerName
    fid = e.target.feature.properties.fid
    
    sql = `select * from [${layerName}] where fid = ${fid}`    
    const {geom, fid, ...obj} = db.prepare(sql).getAsObject($)

    var stringWidths =  Object.keys(obj).map(x => {
         string = `${obj[x]} ${x}`; 
         return parseInt(string.width())
    }).filter(x => x !==undefined)

    maxStringWidth = Math.max(...stringWidths)
    maxStringWidth = Math.ceil(maxStringWidth/50)*50;
    
    popupDiv = $(`<div class="grid-container" style="width: ${maxStringWidth}"></div>`)

    Object.keys(obj).forEach( key => {        
        v = obj[key];
        if (v !== null) {
            string = `${key}: ${v}`
            width = parseInt(string.width())
            div = $(`<div><span class="key">${key}: </span>${v}</div>`);
                
            if (width / maxStringWidth > 0.5) {
                itemclass = 'item span2';
                div.addClass(itemclass);
                div.prependTo(popupDiv)
            } else {
                itemclass = 'item';
                div.addClass(itemclass);              
                div.appendTo(popupDiv)                
            }
        }
    })
        
    popupContent = popupDiv[0].outerHTML
    e.target.bindPopup(popupContent, {minWidth: maxStringWidth}).openPopup()    
}

String.prototype.width = function(font) {
    var f = font || '12px arial',
        o = $('<div></div>')
              .text(this)
              .css({'position': 'absolute', 'float': 'left', 'white-space': 'nowrap', 'visibility': 'hidden', 'font': f})
              .appendTo($('body')),
        w = o.width();  
    o.remove();  
    return w;
  }

function searchObject(obj, key) {
    var result;
    for (var property in obj) {
        if (obj.hasOwnProperty(property)) {
            if (property === key) {
                return obj[key]; // returns the value
            } else if (typeof obj[property] === "object") {
                result = searchObject(obj[property], key);

                if (typeof result !== "undefined") {
                    return result;
                }
            }
        }
    }
}

function findByLabel(o, label) {
    //Early return
    if (o.label === label) {
        return o;
    }
    var result, p;
    for (p in o) {
        if (p == 'layer') {
            continue;
        }

        if (o[p] !== null && o.hasOwnProperty(p) && typeof o[p] === 'object') {
            result = findByLabel(o[p], label);
            if (result) {
                return result;
            }
        }
    }
    return result;
}

function colorAndOpacity(colorString) {
    colorArray = colorString.split(',');
    opacity = parseFloat(colorArray[3]) / 255;
    const rgbToHex = (r, g, b) => '#' + [r, g, b].map(x => {
        const hex = parseFloat(x).toString(16)
        return hex.length === 1 ? '0' + hex : hex
    }).join('')

    hexColor = rgbToHex(...colorArray);
    return [hexColor, opacity]
}

class styleQMLParser {
    constructor(qmlString) {
        var xmlDoc = xmlToJSON.parseString(qmlString);

        this.renderer = xmlDoc.qgis[0]["renderer-v2"][0];
        this.rendererType = this.renderer._attr.type._value;
        this.symbols = searchObject(this.renderer.symbols, 'symbol');
        this.symbolTypes = this.symbols.reduce(function (acc, symbol) {
            let symbolName = symbol._attr.name._value;
            let symbolType = symbol._attr.type._value;
            acc[symbolName] = symbolType;
            return acc;
        }, {});
        this.styles = this.getLayerStyles()
        
        if (Object.values(this.symbolTypes).filter(x => x=='marker').length > 0) {
            this.markerLayerOptions = this.getMarkerLayerOptions()
        }

        if (Object.values(this.symbolTypes).filter(x => x=='fill').length > 0) {
            try {
                this.fillPatternOptions = this.getFillPatternOptions()
           } catch (e) {}            
        }        
    }


    getSymbolStyle(symbol) {
        let symbolType = symbol._attr.type._value;
        let layers = searchObject(symbol, "layer");
        let extraLayers = searchObject(layers, "layer");
        let symbolAlpha = symbol._attr.alpha._value
        //Normally markers for Markerlines or PointPatterns and lines for FillLinePatterns
        if (extraLayers) {
            layers.push(...extraLayers)
        }

        let layersProperties = layers.map(function (layer) {
            return {
                classType: layer._attr.class._value,
                properties: layer.prop.reduce((acc, item) => {
                    acc[item['_attr']['k']['_value']] = item['_attr']['v']['_value'];
                    acc['alpha'] = symbolAlpha
                    return acc;
                }, {})
            }
        })
        
        if (symbolType === 'fill') {
            let fillObject = layersProperties.filter(obj => obj.classType === 'SimpleFill')[0];
            if (fillObject) {            
                return this.getFillStyle(layersProperties)
            } else {
                return this.getLineStyle(layersProperties)
            }

        } else if (symbolType === 'line') {
            return this.getLineStyle(layersProperties)

        } else if (symbolType === 'marker') {
            return this.getMarkerStyle(layersProperties)
        }        
    }


    getLineStyle(properties) {
        let style = {}
        
        let lineObject = properties.filter(obj => obj.classType === 'SimpleLine')[0];
        
        let lineProps = lineObject['properties'];
        style['color'] = colorAndOpacity(lineProps.line_color)[0]
        style['opacity'] = lineProps.alpha
        style['weight'] = parseFloat(lineProps.line_width)
        style['lineJoin'] = lineProps.joinstyle
        style['lineCap'] = lineProps.capstyle
        //GEt dashArray
        if (lineProps.line_style !== 'solid') {
            style['dashArray'] = lineProps.custom_dash.replace(';', ", ")
        }

        return style
    }


    getFillStyle(properties) {
        let style = {}
        let fillObject = properties.filter(obj => obj.classType === 'SimpleFill')[0];
        let patternObject = properties.map(obj => obj.classType.toLowerCase().includes('pattern'))[0]
        
        let fillProps = fillObject['properties'];

        style['color'] = colorAndOpacity(fillProps.outline_color)[0]
        style['opacity'] = fillProps.alpha
        
        if (!patternObject) {
            let colorOpacity = colorAndOpacity(fillProps.color)
            style['fillColor'] = colorOpacity[0]
            style['fillOpacity'] = fillProps.alpha 
        }

        style['lineJoin'] = fillProps.joinstyle
        style['weight'] = parseFloat(fillProps.outline_width);

        return style;
    }

    getMarkerStyle(properties) {
        let style = {}
        var markerObject = properties.filter(obj => obj.classType === 'SimpleMarker')[0];
        let markerProps = markerObject.properties;
        let markerType = markerProps.name;
        if (markerType === 'circle') {
            style['radius'] = parseFloat(markerProps.size) / 2;
            style['fillColor'] = colorAndOpacity(markerProps.color)[0]
            style['color'] = colorAndOpacity(markerProps.outline_color)[0]
        }

        return style
    }

    getFillPatternOptions() {
        try {
           var fillerProps = this.getLineLayerOptions()
        } catch (e) {
            var fillerProps = this.getMarkerLayerOptions()
        }
        
        let symFillPatternOptions = this.symbols.reduce(function (symbolProperties, symbol) {
            let layers = searchObject(symbol, 'layer')
            let extraLayers = searchObject(layers, "layer");
            if (extraLayers) {
                layers.push(...extraLayers)
            }
            let patternLayer = layers.filter(obj => obj._attr.class._value.toLowerCase().includes('pattern'))[0];
            let patternType = patternLayer._attr.class._value
            
            
            let properties = patternLayer['prop'].reduce((acc, item) => {
                acc[item['_attr']['k']['_value']] = item['_attr']['v']['_value'];
                acc['patternType'] = patternType;                   
                                
                return acc;
            }, {})
            symbolProperties[symbol._attr.name._value] = properties;
            return symbolProperties
        }, {})

        symFillPatternOptions = this.returnFormatted(symFillPatternOptions)
        
        return Object.keys(symFillPatternOptions).reduce((acc, key) => {
            let option = symFillPatternOptions[key];
            if (option.patternType === 'PointPatternFill') {
                option['markerOptions'] = fillerProps[key]

            }  
            if (option.patternType === 'LinePatternFill') {
                option['lineOptions'] = fillerProps[key]
            }  
            acc[key] = option;
            return acc  
            
        }, {})
        
    }

    getMarkerLayerOptions() {
        let symMarkerOptions = this.symbols.reduce(function (symbolProperties, symbol) {
            let layers = searchObject(symbol, 'layer')
            let markerLayer = layers.filter(obj => obj._attr.class._value === 'SimpleMarker')[0];
            
            let properties = markerLayer['prop'].reduce((acc, item) => {
                acc[item['_attr']['k']['_value']] = item['_attr']['v']['_value'];
                return acc;
            }, {})
            symbolProperties[symbol._attr.name._value] = properties;
            return symbolProperties
        }, {})

        return this.returnFormatted(symMarkerOptions)
    }

    getLineLayerOptions()  {
        let symLineOptions = this.symbols.reduce(function (symbolProperties, symbol) {
            let layers = searchObject(symbol, 'layer')
            let lineLayer = layers.filter(obj => obj._attr.class._value === 'SimpleLine')[0];
            
            let properties = lineLayer['prop'].reduce((acc, item) => {
                acc[item['_attr']['k']['_value']] = item['_attr']['v']['_value'];
                return acc;
            }, {})
            symbolProperties[symbol._attr.name._value] = properties;
            return symbolProperties
        }, {})

        return this.returnFormatted(symLineOptions)
    }

    getLayerStyles() {
        let styles = this.symbols.map(sym => [sym, this.getSymbolStyle(sym)])
        var symbolStyles = styles.reduce(function (acc, arr) {
            let symbolName = arr[0]._attr.name._value;
            let style = arr[1];
            acc[symbolName] = style;
            return acc;
        }, {});

        return this.returnFormatted(symbolStyles)
    }

    returnFormatted(returnObject) {
        if (this.rendererType === 'singleSymbol') {
            return returnObject

        } else if (this.rendererType === "categorizedSymbol") {
            var items = searchObject(this.renderer.categories, 'category');

        } else if (this.rendererType === "graduatedSymbol") {
            var items = searchObject(this.renderer.ranges, 'range')

        }
        // TODO: RuleRenderer

        return items.reduce(function (acc, item) {
            let symbolName = item._attr.symbol._value;
            let itemName = item._attr.label._value
            let partObject = returnObject[symbolName]
            acc[itemName] = partObject;
            return acc;
        }, {});
    }
}

function getGeoJSON(layerName) {
    data = db.exec(`select * from [${layerName}] where not st_isempty(geom)`)[0];
    features = data.values.map((row) => {
        geomIndex = data.columns.indexOf('geom')
        idIndex = data.columns.indexOf('fid')
       
        buffer = row[geomIndex]
        geometry = new GeoPackage.GeometryData(buffer).geometry.toGeoJSON()
        id = row[idIndex]

        properties =  data.columns.reduce((acc, col, index) => {            
            if (col !== 'geom') {
                 acc[col] = row[index]
            }            
            return acc
        }, {})
        return {type: "Feature", properties: properties, id: id, geometry: geometry}

    })

    return {type: "FeatureCollection", features: features}
}

function getLayerAsGeoJSON(layerName, skipEmptyGeometry=false) {
    sql = `SELECT * FROM [${layerName}]`;
    
    if (skipEmptyGeometry){
        sql = `SELECT * FROM [${layerName}] where not st_isempty(geom)` 
    }

    let features = []
    stmt = db.prepare(sql)
    stmt.bind({$})
    while(stmt.step()) {        
        const {fid, geom, ...properties} = stmt.getAsObject();
        geometry = new GeoPackage.GeometryData(geom).geometry.toGeoJSON();
        feature = {type: "Feature", properties: properties, id: fid, geometry: geometry}
        features.push(feature)
      }

    return {type: "FeatureCollection", features: features}
}

function hexToBytes(hex) {
    for (var bytes = [], c = 0; c < hex.length; c += 2)
        bytes.push(parseInt(hex.substr(c, 2), 16));
    return bytes;
}
const fromHexString = hexString =>
  new Uint8Array(hexString.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));


async function getQGISProject() {
    stmt = db.prepare("SELECT content FROM qgis_projects")
    hexstring = stmt.getAsObject({$content:1}).content;
    bytes = new Uint8Array(hexstring.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
    const reader = new zip.Uint8ArrayReader(bytes)
    const zipReader = new zip.ZipReader(reader);
    const entries = await zipReader.getEntries();
    const data = await entries[0].getData(new zip.TextWriter());
    qgsDocumentObject = xmlToJSON.parseString(data)
    return qgsDocumentObject
}