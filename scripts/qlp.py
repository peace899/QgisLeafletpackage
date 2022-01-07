import os
import json

from shutil import copyfile
from urllib.parse import unquote

from qgis.PyQt.QtCore import QUuid, QSize, QByteArray, QBuffer, QIODevice, QDateTime, pyqtSignal, QThread, QUrl
from qgis.core import  QgsLayerTreeGroup, QgsSymbolLayerUtils, QgsCoordinateReferenceSystem, QgsApplication, QgsProcessingFeedback
from qgis import processing, utils

class LeafExport(QThread):
    feedback = pyqtSignal(str)
    done = pyqtSignal()
    saveproject = pyqtSignal(str)

    def __init__(self, project, out_path):
        super(QThread, self).__init__()
        self.project = project 
        self._path = os.path.dirname(__file__)

        self.process_feedback = QgsProcessingFeedback()
        self.process_feedback.progressChanged.connect(self.progress_changed)
        
        self.create_ouput_path(out_path)
        self.gpkg_file = os.path.join(self.save_path, 'qlproject.gpkg')

        self.vectorlayers = []
        self.wmslayers = []
        self.tree_groups = []  # Project tree groups
        self.legend_icons = []
    
    def run(self):
        self.create_tree()
        self.create_geopackage() 
        self.create_attributes()
        self.save_project()

    def progress_changed(self, progress):
        self.feedback.emit(f"Processing progress: {progress}")

    def create_ouput_path(self, out_path):
        project_path = self.project.fileName()
        path, filename = os.path.split(project_path)
        self.project_name = self.project.baseName()
        create_time = QDateTime.currentDateTime().toString('yyyyMMdd_HHmmss')
        self.save_path = os.path.join(
            out_path, f'{self.project_name}_{create_time}')
        if not os.path.exists(self.save_path):
            os.makedirs(self.save_path)

    def create_info_tables(self, data, image_data):
        self.feedback.emit('Creating Attributes tables....')
        scripts_create_stmt = """CREATE TABLE leaflet_info (
            id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
            data_type TEXT,
            content TEXT
            )
        """
        images_create_stmt = """CREATE TABLE symbol_pixmaps (
            id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
            symbol_id TEXT,
            content TEXT
            )
        """

        con = utils.spatialite_connect(self.gpkg_file)
        con.execute(scripts_create_stmt)
        con.execute(images_create_stmt)
        #current_time = datetime.now().isoformat(timespec='milliseconds') +'Z'
        current_time = QDateTime.currentDateTime().toString('yyyy-MM-ddThh:mm:ss.zzzZ')

        con.execute("""INSERT INTO gpkg_contents(table_name, data_type, identifier, description, last_change, srs_id) 
                VALUES (?,?,?,?,?,?);""", ('leaflet_info', 'attributes', 'leaflet_info', '', current_time, 0))

        con.execute("""INSERT INTO gpkg_contents(table_name, data_type, identifier, description, last_change, srs_id) 
                VALUES (?,?,?,?,?,?);""", ('symbol_pixmaps', 'attributes', 'symbol_pixmaps', '', current_time, 0))

        con.executemany(
            'insert into leaflet_info (data_type, content) values (?,?)', data)
        con.executemany(
            'insert into symbol_pixmaps (symbol_id, content) values (?,?)', image_data)
        con.commit()
        con.close()
        self.feedback.emit('Attributes tables: completed')

    def add_to_parent(self, tree_layer, layer_item):
        if tree_layer.depth() > 1:
            # check if layer has a group and attach to said group
            parent_item = tree_layer.parent()
            if parent_item.name() in self.tree_groups_names:
                group = [g for g in self.tree_groups if g['label']
                         == tree_layer.parent().name()][0]
                group['children'].append(layer_item)

            else:
                group_item = {'label': parent_item.name(
                ), 'children': [], 'selectAllCheckbox': True, 'collapsed': True}
                group_item['children'].append(layer_item)
                self.add_to_parent(parent_item, group_item)

        else:
            # layer does not belong to group attach to root
            self.layer_tree['children'].append(layer_item)

    def get_pixmap_base64(self, symbol, id):
        icon = QgsSymbolLayerUtils.symbolPreviewPixmap(symbol, QSize(16, 16))
        ba = QByteArray()
        buff = QBuffer(ba)
        buff.open(QIODevice.WriteOnly)
        ok = icon.save(buff, "PNG")
        assert ok
        pixmap_base64_string = str(ba.toBase64(), 'utf-8')
        data = (id, pixmap_base64_string)
        self.legend_icons.append(data)

    def create_tree(self):
        # Create project groups
        self.feedback.emit('Creating LayerTree....')
        root = self.project.layerTreeRoot()
        self.feedback.emit(f'Found {len(root.findLayers())} layers..')
        for item in root.children():
            if isinstance(item, QgsLayerTreeGroup):
                item = {'label': item.name(), 'children': [],
                        'selectAllCheckbox': True, 'collapsed': True}
                self.tree_groups.append(item)

        self.layer_tree = {'label': self.project_name, 'children': [],
                    'selectAllCheckbox': True, 'collapsed': False}
        self.tree_groups_names = [group['label'] for group in self.tree_groups]

        for tree_layer in root.findLayers():

            layer = tree_layer.layer()
            layer_name = layer.name()
            self.feedback.emit(f'Adding to layertree: {layer_name}')

            if layer.providerType() == 'ogr':
                self.vectorlayers.append(layer)
                layer_symbol_type = layer.renderer().type()

                if layer_symbol_type == 'categorizedSymbol':
                    # get categories as layers
                    render_attribute = layer.renderer().classAttribute()
                    layer_item = {'label': layer_name, 'children': [], 'selectAllCheckbox': True, 'collapsed': True,
                                'renderType': layer_symbol_type, 'propKey': render_attribute, 'layerType': layer.providerType()}
                    categories = layer.renderer().categories()
                    for category in categories:
                        id = QUuid.createUuid().toString(QUuid.Id128)
                        category_item = {'label': category.label(), 'id': id}
                        layer_item['children'].append(category_item)
                        symbol = category.symbol()
                        self.get_pixmap_base64(symbol, id)

                elif layer_symbol_type == 'graduatedSymbol':
                    # get ranges as layers
                    render_attribute = layer.renderer().classAttribute()
                    layer_item = {'label': layer_name, 'children': [], 'selectAllCheckbox': True, 'collapsed': True,
                                'renderType': layer_symbol_type, 'propKey': render_attribute, 'layerType': layer.providerType()}
                    ranges = layer.renderer().ranges()
                    for range in ranges:
                        id = QUuid.createUuid().toString(QUuid.Id128)
                        range_item = {'label': range.label(), 'id': id, 'range': [
                            range.lowerValue(), range.upperValue()]}
                        layer_item['children'].append(range_item)
                        symbol = range.symbol()
                        self.get_pixmap_base64(symbol, id)

                elif layer_symbol_type == 'singleSymbol':
                    id = QUuid.createUuid().toString(QUuid.Id128)
                    layer_item = {'label': layer_name, 'id': id,
                                'renderType': layer_symbol_type}
                    symbol = layer.renderer().symbol()
                    self.get_pixmap_base64(symbol, id)

            elif layer.providerType() == 'wms':
                params = dict(x.split('=')
                            for x in layer.styleURI().split('&') if '=' in x)
                params['url'] = unquote(params['url'])
                layer_item = {'label': layer_name,
                            'layerType': layer.providerType(), 'params': params}
                self.wmslayers.append(layer_name)

            self.add_to_parent(tree_layer, layer_item)

        for group in self.tree_groups:
            self.layer_tree['children'].append(group)


    def create_geopackage(self):
        # Save layers to geopackage
        project_crs = self.project.crs()        
        self.feedback.emit(f'Writing layers to geopackage: {self.gpkg_file}')
        for vl in self.vectorlayers:
            vl.setCrs(project_crs)           

        processing.run("native:package",
                    {'LAYERS': self.vectorlayers,
                        'OUTPUT': self.gpkg_file,
                        'OVERWRITE': False,
                        'SAVE_STYLES': True},
                        feedback=self.process_feedback)
        self.feedback.emit('Layers added successfully!!!')

    def create_attributes(self):
        # Create attributes table to store layer_tree and script
        
        js_script = os.path.join(self._path, 'layerScript.js')
        with open(js_script, 'r') as f:
            script_data = f.read()  # .replace('\n', ' ')

        info_data = [('layer_tree', str(json.dumps(self.layer_tree))),
                    ('wms_layers', ', '.join(self.wmslayers)),
                    ('layer_script', script_data)]

        self.create_info_tables(info_data, self.legend_icons)

    # Save to new project in the geopackage
    def test_directory(self):
        return os.path.dirname(__file__)

    def geopackage_add_project(self):

        with open(self.outfile, 'rb') as f:
            data = f.read()
        
        hexblob = data.hex()
        modification_time = QDateTime.currentDateTime().toString('yyyy-MM-ddTHH:mm:ss')
        user = QgsApplication.userLoginName()
        metadata = {"last_modified_time": modification_time, "last_modified_user": user }

        create_stmt = "CREATE TABLE qgis_projects (name TEXT PRIMARY KEY, metadata BLOB, content BLOB)"
        con = utils.spatialite_connect(self.gpkg_file)
        con.execute(create_stmt)
        con.execute("""INSERT INTO qgis_projects(name, metadata, content) 
                VALUES (?,?,?);""", (self.project_name, json.dumps(metadata), hexblob))
        con.commit()
        con.close()
        
        self.feedback.emit('Done')
        self.feedback.emit(f'New QGIS project file saved at {self.outfile}')
        self.feedback.emit(f'QGISLeafletpackage output directory: {self.save_path}')
        self.done.emit()


    def save_project(self):
        # copy html template to output directory
        html_file = os.path.join(self._path, 'map.html')
        out_html_file = os.path.join(self.save_path, 'map.html')
        copyfile(html_file, out_html_file)

        # copy styles.css to output directory
        css_file = os.path.join(self._path, 'styles.css')
        out_css_file = os.path.join(self.save_path, 'styles.css')
        copyfile(css_file, out_css_file)
        
        
        for vl in self.vectorlayers:
            base_name = vl.name()
            provider = vl.providerType()
            gpkg_layer = self.gpkg_file + f"|layername={base_name}"
            options = vl.dataProvider().ProviderOptions()
            vl.setDataSource(gpkg_layer, base_name, provider, options)
        
        # Save project to file and also to geopackage
        # Saving has to be in the main thread. QGIS crashes when saving project in this thread
        self.outfile = os.path.join(self.save_path, f"{self.project_name}.qgz")
        self.saveproject.emit(self.outfile)


