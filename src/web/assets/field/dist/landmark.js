/* global L, Craft, CodeMirror */

(function() {
    'use strict';

    const ALLOWED = {
        marker: ['Point', 'MultiPoint'],
        line: ['LineString', 'MultiLineString'],
        polygon: ['Polygon', 'MultiPolygon'],
        // A rectangle is a polygon, and a circle or a label is a point with its own keys
        rectangle: ['Polygon', 'MultiPolygon'],
        circle: ['Point'],
        dot: ['Point'],
        text: ['Point'],
    };

    /** What the field and the overview map share: the basemaps, icons, sizing and remembered choices. */
    class MapBase {
        /** What a drawn shape carries beyond its geometry: a circle's radius, a label's words. */
        drawnExtras(layer) {
            const extras = {};

            if (typeof layer.getRadius === 'function') {
                extras[layer instanceof L.CircleMarker && !(layer instanceof L.Circle) ? 'dotRadius' : 'radius'] = Math.round(layer.getRadius());
            }

            const text = layer.pm && typeof layer.pm.getText === 'function' ? layer.pm.getText() : null;

            if (text) {
                extras.text = text;
            }

            return extras;
        }

        /** Craft's own icons, with a text glyph as a fallback. */
        icon(name) {
            const icons = this.config.icons || {};

            return icons[name] || { code: '&lt;/&gt;', map: '&#9723;', layers: '&#9776;' }[name] || '';
        }

        /**
         * A map started inside a closed tab or a collapsed block measures itself as tiny,
         * so it is told to measure again once it can be seen, and whenever it is resized.
         */
        watchSize() {
            const container = this.map.getContainer();

            new IntersectionObserver((entries, observer) => {
                if (entries[0].intersectionRatio === 0) {
                    return;
                }

                observer.disconnect();
                this.map.invalidateSize(false);

                if (this.pendingFit) {
                    this.map.fitBounds(this.pendingFit, { padding: [20, 20], maxZoom: 18, animate: false });
                    this.pendingFit = null;
                }
            }).observe(container);

            if (typeof ResizeObserver !== 'undefined') {
                new ResizeObserver(() => this.map.invalidateSize(false)).observe(container);
            }
        }

        /**
         * Scrolling over a map scrolls the page, as it would anywhere else.
         * Zooming asks for the modifier key, and a hint says so when it is missing.
         */
        gateZoom() {
            const container = this.map.getContainer();
            const apple = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
            const hint = L.DomUtil.create('div', 'landmark-gesture', container);
            const held = (e) => (apple ? e.metaKey : e.ctrlKey);

            hint.textContent = `Use ${apple ? '⌘' : 'Ctrl'} + scroll to zoom`;
            this.map.scrollWheelZoom.disable();

            // Leaflet does the zooming, so it is turned on only while the key is down
            const watch = (e) => {
                held(e) ? this.map.scrollWheelZoom.enable() : this.map.scrollWheelZoom.disable();
            };

            window.addEventListener('keydown', watch);
            window.addEventListener('keyup', watch);
            window.addEventListener('blur', () => this.map.scrollWheelZoom.disable());

            container.addEventListener('wheel', (e) => {
                if (held(e)) {
                    hint.classList.remove('is-visible');
                    return;
                }

                hint.classList.add('is-visible');
                clearTimeout(this.hintTimer);
                this.hintTimer = setTimeout(() => hint.classList.remove('is-visible'), 1300);
            }, { passive: true });
        }

        /** A layer switcher for whichever imagery is set up, next to the basemap. */
        initBasemaps() {
            const esri = this.config.esriImagery
                ? L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                    attribution: 'Imagery &copy; Esri, Vantor, Earthstar Geographics, and the GIS User Community',
                    maxZoom: 22,
                    maxNativeZoom: 19,
                })
                : null;

            const add = (google) => this.addBasemapControl(Object.assign(
                { Map: this.basemap },
                google ? { Satellite: google } : {},
                esri ? { 'Esri Imagery': esri } : {}
            ));

            if (!this.config.hasSatellite) {
                add(null);
                return;
            }

            Craft.sendActionRequest('POST', 'landmark/tiles/session')
                .then((response) => {
                    const data = response.data || {};

                    if (!data.tileUrl) {
                        console.warn('Landmark: no satellite layer. ' + (data.error || ''));
                        add(null);
                        return;
                    }

                    add(L.tileLayer(data.tileUrl, { attribution: data.attribution, maxZoom: 22, maxNativeZoom: 20 }));
                })
                .catch((e) => {
                    console.warn('Landmark: no satellite layer.', e);
                    add(null);
                });
        }

        addBasemapControl(layers) {
            if (Object.keys(layers).length < 2) {
                return;
            }

            // The radios are kept out of the entry form. They can appear after Craft
            // has read it, which it would otherwise save as an unsaved change.
            const Layers = L.Control.Layers.extend({
                _createRadioElement(name, checked) {
                    const input = L.Control.Layers.prototype._createRadioElement.call(this, name, checked);

                    input.setAttribute('form', 'landmark-detached');

                    return input;
                },
            });

            const control = new Layers(layers, null, { position: 'topright' }).addTo(this.map);
            const remembered = layers[this.remembered('basemap')];

            if (remembered && remembered !== this.basemap) {
                this.map.removeLayer(this.basemap);
                this.map.addLayer(remembered);
            }

            this.map.on('baselayerchange', (e) => this.remember('basemap', e.name));

            const toggle = control.getContainer().querySelector('.leaflet-control-layers-toggle');

            if (toggle) {
                toggle.classList.add('landmark-layers-toggle');
                toggle.innerHTML = this.icon('layers');
            }
        }

        /** What a map remembers between visits, kept under its own name. */
        remembered(what) {
            try {
                return window.localStorage.getItem(`landmark:${this.config.name}:${what}`);
            } catch (e) {
                return null;
            }
        }

        remember(what, value) {
            try {
                window.localStorage.setItem(`landmark:${this.config.name}:${what}`, value);
            } catch (e) {
                // Storage can be turned off, in which case the choice lasts for this page only
            }
        }
    }

    class Field extends MapBase {
        constructor(id, config) {
            super();
            this.container = document.getElementById(id);

            if (!this.container) {
                return;
            }

            if (typeof L === 'undefined' || !L.map) {
                console.error('Landmark: Leaflet did not load, so the map cannot be drawn.');
                this.container.querySelector('.landmark-code').hidden = false;
                return;
            }

            this.config = config;
            this.input = this.container.querySelector('.landmark-value');
            this.panel = this.container.querySelector('.landmark-code');
            this.textarea = this.container.querySelector('.landmark-json');
            this.error = this.container.querySelector('.landmark-error');
            this.typing = false;

            this.initMap();
            this.initCodePanel();
            this.initContext();
        }

        initMap() {
            const c = this.config;

            this.map = L.map(this.container.querySelector('.landmark-map'), {
                center: c.centre,
                zoom: c.zoom,
            });

            this.basemap = L.tileLayer(c.basemapUrl, {
                attribution: c.basemapAttribution,
                maxZoom: 22,
                maxNativeZoom: 20,
            }).addTo(this.map);

            this.layers = L.featureGroup().addTo(this.map);
            this.watchSize();
            this.gateZoom();
            this.draw(c.geometry, true);

            if (!this.map.pm) {
                console.error('Landmark: Leaflet-Geoman did not load, so there are no drawing tools.');
                return;
            }

            const editing = c.editingTools || [];

            this.map.pm.addControls(Object.assign({
                position: 'topleft',
                editMode: editing.includes('edit'),
                dragMode: editing.includes('drag'),
                cutPolygon: editing.includes('cut'),
                removalMode: editing.includes('remove'),
                rotateMode: editing.includes('rotate'),
            }, this.drawTools()));

            this.map.pm.setGlobalOptions({ snappable: true, snapDistance: 15 });

            this.map.on('pm:create', (e) => {
                // Cutting draws a shape of its own, which pm:cut deals with
                if (e.shape === 'Cut') {
                    return;
                }

                const extras = this.drawnExtras(e.layer);

                if (Object.keys(extras).length) {
                    e.layer.landmarkExtras = extras;
                }

                if (!this.config.allowMultiple) {
                    this.layers.eachLayer((layer) => {
                        if (layer !== e.layer) {
                            this.layers.removeLayer(layer);
                        }
                    });
                }
                this.layers.addLayer(e.layer);
                this.preview(e.layer, extras);
                this.watch(e.layer);
                this.sync();
            });

            this.map.on('pm:remove', () => this.sync());

            // What's left of a cut shape takes the original's place, keys and all
            this.map.on('pm:cut', (e) => {
                const extras = e.originalLayer.landmarkExtras;

                this.layers.removeLayer(e.originalLayer);

                if (e.layer) {
                    this.map.removeLayer(e.layer);

                    if (extras) {
                        e.layer.landmarkExtras = extras;
                    }

                    this.layers.addLayer(e.layer);
                    this.preview(e.layer, extras || {});
                    this.watch(e.layer);
                }

                this.sync();
            });

            this.initBasemaps();
        }

        drawTools() {
            const shapes = this.config.shapes || [];

            return {
                drawMarker: shapes.includes('marker'),
                drawPolyline: shapes.includes('line'),
                drawPolygon: shapes.includes('polygon'),
                drawRectangle: shapes.includes('rectangle'),
                drawCircle: shapes.includes('circle'),
                drawCircleMarker: shapes.includes('dot'),
                drawText: shapes.includes('text'),
            };
        }

        /**
         * The GeoJSON panel covers the map, while the control that opens it stays above.
         */
        initCodePanel() {
            this.map.getContainer().appendChild(this.panel);

            // The panel sits inside the map container, which would otherwise take
            // its wheel as a zoom and its text selection as a drag
            L.DomEvent.disableScrollPropagation(this.panel);
            L.DomEvent.disableClickPropagation(this.panel);

            const button = L.Control.extend({
                options: { position: 'topright' },
                onAdd: () => {
                    const bar = L.DomUtil.create('div', 'leaflet-bar leaflet-control landmark-code-control');
                    const link = L.DomUtil.create('a', 'leaflet-buttons-control-button', bar);

                    link.href = '#';
                    link.title = Craft.t('landmark', 'Edit GeoJSON');
                    link.setAttribute('role', 'button');
                    link.setAttribute('aria-pressed', 'false');
                    link.innerHTML = this.icon('code');

                    L.DomEvent.on(link, 'click', (e) => {
                        L.DomEvent.stop(e);
                        this.toggleCode(this.panel.hidden, link);
                    });

                    this.codeButton = link;

                    return bar;
                },
            });

            this.map.addControl(new button());
        }

        toggleCode(open, link) {
            this.panel.hidden = !open;
            link.setAttribute('aria-pressed', String(open));
            link.classList.toggle('is-on', open);
            link.innerHTML = this.icon(open ? 'map' : 'code');
            link.title = Craft.t('landmark', open ? 'Back to the map' : 'Edit GeoJSON');
            this.map.getContainer().classList.toggle('landmark-editing', open);

            if (!open) {
                return;
            }

            if (!this.editor && typeof CodeMirror !== 'undefined') {
                this.editor = CodeMirror.fromTextArea(this.textarea, {
                    mode: { name: 'javascript', json: true },
                    lineWrapping: true,
                });
                this.editor.on('change', (editor) => {
                    editor.save();
                    this.typing = true;
                    this.parse(editor.getValue());
                });
            }

            if (this.editor) {
                this.editor.refresh();
                this.editor.focus();
            } else {
                this.textarea.addEventListener('input', () => {
                    this.typing = true;
                    this.parse(this.textarea.value);
                });
            }
        }

        /** Other entries' shapes, drawn behind this field's own and never editable. */
        initContext() {
            const context = this.config.context;

            if (!context) {
                return;
            }

            this.contextKey = context.relation ? context.relation.uid : null;
            this.sources = {};
            this.hidden = {};

            this.contextRelated = this.startingRelated(context.relation);

            context.sources.forEach((source) => {
                this.sources[source.uid] = [];
            });

            this.addContextControl(context);
            this.loadContext();
        }

        loadContext() {
            const context = this.config.context;

            Craft.sendActionRequest('POST', 'landmark/context/shapes', {
                data: {
                    sources: context.sources.map((s) => s.uid),
                    relations: context.relation ? context.relation.fields : [],
                    related: this.contextRelated,
                    exclude: context.exclude,
                    limit: context.limit,
                },
            })
                .then((response) => {
                    const features = (response.data && response.data.features) || [];

                    this.clearContext();

                    features.forEach((feature) => {
                        const source = context.sources.find((s) => s.uid === feature.properties.source);

                        if (!source || !this.sources[source.uid]) {
                            return;
                        }

                        // pmIgnore keeps them out of editing, snapIgnore false keeps them as snap targets
                        L.geoJSON(feature, {
                            pmIgnore: true,
                            snapIgnore: false,
                            interactive: true,
                            renderer: L.canvas(),
                            style: { color: source.colour, weight: 1, fillOpacity: 0.08, opacity: 0.6 },
                            pointToLayer: (point, latlng) => L.circleMarker(latlng, {
                                radius: 4,
                                pmIgnore: true,
                                snapIgnore: false,
                                color: source.colour,
                                weight: 1,
                                fillOpacity: 0.4,
                            }),
                        })
                            // Geoman only snaps to layers on the map itself, not to those inside groups
                            .getLayers()
                            .forEach((layer) => {
                                layer.bindTooltip(feature.properties.title || source.label, { direction: 'top', sticky: true });
                                this.sources[source.uid].push(layer);

                                if (!this.hidden[source.uid]) {
                                    layer.addTo(this.map);
                                }
                            });
                    });
                })
                .catch((e) => {
                    console.warn('Landmark: could not load other shapes.', e);
                });
        }

        readChoice() {
            return this.contextKey ? this.remembered(this.contextKey) : null;
        }

        writeChoice(value) {
            if (this.contextKey) {
                this.remember(this.contextKey, value);
            }
        }

        clearContext() {
            Object.values(this.sources).forEach((layers) => {
                layers.forEach((layer) => this.map.removeLayer(layer));
                layers.length = 0;
            });
        }

        addContextControl(context) {
            const control = L.Control.extend({
                options: { position: 'bottomleft' },
                onAdd: () => {
                    const box = L.DomUtil.create('div', 'leaflet-bar leaflet-control landmark-context');

                    L.DomEvent.disableClickPropagation(box);
                    L.DomEvent.disableScrollPropagation(box);

                    context.sources.forEach((source) => {
                        const row = L.DomUtil.create('label', 'landmark-context-source', box);
                        const tick = L.DomUtil.create('input', '', row);

                        tick.type = 'checkbox';
                        tick.checked = true;
                        tick.addEventListener('change', () => {
                            this.hidden[source.uid] = !tick.checked;
                            this.sources[source.uid].forEach((layer) => {
                                tick.checked ? layer.addTo(this.map) : this.map.removeLayer(layer);
                            });
                        });

                        const swatch = L.DomUtil.create('span', 'landmark-context-swatch', row);
                        swatch.style.backgroundColor = source.colour;

                        L.DomUtil.create('span', '', row).textContent = source.label;
                    });

                    // One year is no choice, so the picker is left out
                    if (context.relation && (context.relation.options || []).length !== 1) {
                        const row = L.DomUtil.create('label', 'landmark-context-relation', box);

                        L.DomUtil.create('span', '', row).textContent = context.relation.label;

                        const select = L.DomUtil.create('select', '', row);
                        select.innerHTML = '<option value="">' + Craft.t('landmark', 'All') + '</option>';
                        select.addEventListener('change', () => {
                            this.contextRelated = select.value ? [Number(select.value)] : (context.relation.selected || []);
                            this.writeChoice(select.value);
                            this.loadContext();
                        });

                        if ((context.relation.options || []).length) {
                            this.fillOptions(select, context.relation.options);
                        } else {
                            this.fillRelationOptions(select, context.relation);
                        }
                    }

                    return box;
                },
            });

            this.map.addControl(new control());
        }

        /**
         * A choice is kept for this field, so it holds from one entry to the next, but only
         * where this entry is offered it. Otherwise the entry's own relations stand.
         */
        startingRelated(relation) {
            const saved = this.readChoice();
            const options = (relation && relation.options) || [];
            const offered = options.map((option) => String(option.id));

            // Nothing is on offer with one year, so a choice made elsewhere doesn't apply
            if (options.length === 1) {
                return relation.selected || [];
            }

            if (saved === null || (saved !== '' && options.length && !offered.includes(saved))) {
                return (relation && relation.selected) || [];
            }

            return saved === '' ? (relation.selected || []) : [Number(saved)];
        }

        fillOptions(select, options) {
            options.forEach((option) => {
                const el = document.createElement('option');

                el.value = option.id;
                el.textContent = option.title;
                select.appendChild(el);
            });

            select.value = this.contextRelated.length === 1 ? String(this.contextRelated[0]) : '';
        }

        fillRelationOptions(select, relation) {
            Craft.sendActionRequest('POST', 'landmark/context/options', { data: { relations: relation.fields } })
                .then((response) => this.fillOptions(select, (response.data && response.data.options) || []))
                .catch(() => {});
        }

        draw(geometry, fit) {
            this.layers.clearLayers();

            if (!geometry) {
                return;
            }

            // Shapes are drawn one at a time so a collection stays editable and each
            // keeps whatever was written against it
            const unpack = (layer, extras) => {
                if (layer.getLayers) {
                    layer.getLayers().forEach((child) => unpack(child, extras));
                    return;
                }

                if (Object.keys(extras).length) {
                    layer.landmarkExtras = extras;
                }

                this.preview(layer, extras);

                this.layers.addLayer(layer);
                this.watch(layer);
            };

            const shapes = geometry.type === 'GeometryCollection' ? geometry.geometries : [geometry];

            shapes.forEach((shape) => {
                const extras = this.extras(shape);
                const rebuilt = this.rebuild(shape, extras);

                if (rebuilt) {
                    unpack(rebuilt, extras);
                    return;
                }

                L.geoJSON(shape).getLayers().forEach((layer) => unpack(layer, extras));
            });

            if (fit && this.layers.getLayers().length) {
                const bounds = this.layers.getBounds();

                if (bounds.isValid()) {
                    // Fitting a map that cannot be seen yet gets the wrong zoom, so it waits
                    if (this.map.getContainer().offsetParent === null) {
                        this.pendingFit = bounds;
                    } else {
                        this.map.fitBounds(bounds, { padding: [20, 20], maxZoom: 18, animate: false });
                    }
                }
            }
        }

        /** A circle or a label from a point that carries its radius or its words. */
        rebuild(shape, extras) {
            if (shape.type !== 'Point') {
                return null;
            }

            const [lng, lat] = shape.coordinates;

            if (extras.radius) {
                return L.circle([lat, lng], { radius: extras.radius });
            }

            if (extras.dotRadius) {
                return L.circleMarker([lat, lng], { radius: extras.dotRadius });
            }

            if (extras.text) {
                return L.marker([lat, lng], { textMarker: true, text: extras.text });
            }

            return null;
        }

        watch(layer) {
            ['pm:edit', 'pm:dragend', 'pm:rotateend', 'pm:markerdragend', 'pm:textchange'].forEach((event) => {
                layer.on(event, () => {
                    // A resized circle or a retyped label keeps what GeoJSON has no room for
                    const extras = Object.assign({}, layer.landmarkExtras, this.drawnExtras(layer));

                    if (Object.keys(extras).length) {
                        layer.landmarkExtras = extras;
                    }

                    this.sync();
                });
            });
        }

        sync() {
            const geometry = this.geometry();

            this.config.geometry = geometry;
            this.input.value = geometry ? JSON.stringify(geometry) : '';

            if (!this.typing) {
                const text = geometry ? JSON.stringify(geometry, null, 2) : '';

                if (this.editor) {
                    this.editor.setValue(text);
                } else {
                    this.textarea.value = text;
                }
            }

            this.setError('');
        }

        /**
         * Anything written against a shape beyond its geometry. GeoJSON allows these,
         * and they are kept as typed: what they mean is for the front end to decide.
         */
        extras(shape) {
            const keep = {};

            Object.keys(shape).forEach((key) => {
                if (key !== 'type' && key !== 'coordinates' && key !== 'geometries') {
                    keep[key] = shape[key];
                }
            });

            return keep;
        }

        /** Colour and opacity are shown while editing, so the field matches the front end. */
        preview(layer, extras) {
            if (!layer.setStyle) {
                return;
            }

            const style = {};
            const opacity = extras.opacity != null ? extras.opacity : this.config.opacity;

            if (opacity != null) {
                style.fillOpacity = opacity;
            }

            if (extras.colour) {
                style.color = extras.colour;
                style.fillColor = extras.colour;
            }

            if (Object.keys(style).length) {
                layer.setStyle(style);
            }
        }

        geometry() {
            const layers = this.layers.getLayers();

            if (!layers.length) {
                return null;
            }

            const geometries = layers.map((layer) => {
                const geometry = layer.toGeoJSON().geometry;

                return layer.landmarkExtras ? Object.assign(geometry, layer.landmarkExtras) : geometry;
            });

            if (geometries.length === 1) {
                return geometries[0];
            }

            const types = geometries.map((g) => g.type);
            const styled = layers.some((layer) => layer.landmarkExtras);

            // Shapes of one kind collapse into a Multi, unless one carries its own
            // keys, which a single geometry has nowhere to keep
            if (!styled && types.every((type) => type === types[0])) {
                return {
                    type: 'Multi' + types[0],
                    coordinates: geometries.map((g) => g.coordinates),
                };
            }

            return { type: 'GeometryCollection', geometries: geometries };
        }

        /**
         * Reads typed GeoJSON. A Feature or FeatureCollection is accepted, and its geometry used.
         */
        parse(text) {
            const trimmed = text.trim();

            if (trimmed === '') {
                this.layers.clearLayers();
                this.input.value = '';
                this.config.geometry = null;
                this.setError('');
                return;
            }

            let parsed;

            try {
                parsed = JSON.parse(trimmed);
            } catch (e) {
                this.setError(Craft.t('landmark', 'This isn’t valid JSON.'));
                return;
            }

            const geometry = geometryOf(parsed);

            if (!geometry) {
                this.setError(Craft.t('landmark', 'No geometry found in this JSON.'));
                return;
            }

            if (!this.allows(geometry.type, geometry)) {
                this.setError(Craft.t('landmark', 'This field doesn’t accept {type}.', { type: geometry.type }));
                return;
            }

            this.setError('');
            this.draw(geometry, false);
            this.config.geometry = geometry;
            this.input.value = JSON.stringify(geometry);
        }

        allows(type, geometry) {
            if (type === 'GeometryCollection') {
                return (geometry.geometries || []).every((g) => this.allows(g.type, g));
            }

            return (this.config.shapes || []).some((shape) => (ALLOWED[shape] || []).includes(type));
        }

        setError(message) {
            this.error.textContent = message;
            this.error.hidden = message === '';
        }
    }

    /** Every shape from a field's sources on one map. Double-clicking a shape opens its entry. */
    class Overview extends MapBase {
        constructor(id, config) {
            super();
            this.container = document.getElementById(id);

            if (!this.container || typeof L === 'undefined' || !L.map) {
                return;
            }

            this.config = config;
            this.sources = {};
            this.hidden = {};
            this.related = [];
            this.fitted = false;
            // A little slack around each shape, so thin lines and small markers are easy to hit
            this.renderer = L.canvas({ tolerance: 4 });

            this.map = L.map(this.container.querySelector('.landmark-map'), {
                center: config.centre,
                zoom: config.zoom,
            });

            this.basemap = L.tileLayer(config.basemapUrl, {
                attribution: config.basemapAttribution,
                maxZoom: 22,
                maxNativeZoom: 20,
            }).addTo(this.map);

            config.sources.forEach((source) => {
                this.sources[source.uid] = [];
                this.hidden[source.uid] = this.remembered(`hidden:${source.uid}`) === '1';
            });

            this.watchSize();
            this.gateZoom();
            this.initBasemaps();
            this.addControl();
        }

        addControl() {
            const control = L.Control.extend({
                options: { position: 'bottomleft' },
                onAdd: () => {
                    const box = L.DomUtil.create('div', 'leaflet-bar leaflet-control landmark-context');

                    L.DomEvent.disableClickPropagation(box);
                    L.DomEvent.disableScrollPropagation(box);

                    this.config.sources.forEach((source) => {
                        const row = L.DomUtil.create('label', 'landmark-context-source', box);
                        const tick = L.DomUtil.create('input', '', row);

                        tick.type = 'checkbox';
                        tick.checked = !this.hidden[source.uid];
                        tick.addEventListener('change', () => {
                            this.hidden[source.uid] = !tick.checked;
                            this.remember(`hidden:${source.uid}`, tick.checked ? '0' : '1');
                            this.sources[source.uid].forEach((layer) => {
                                tick.checked ? layer.addTo(this.map) : this.map.removeLayer(layer);
                            });
                        });

                        L.DomUtil.create('span', 'landmark-context-swatch', row).style.backgroundColor = source.colour;
                        L.DomUtil.create('span', '', row).textContent = source.label;
                    });

                    if ((this.config.relations || []).length) {
                        this.addRelationPicker(box);
                    } else {
                        this.load();
                    }

                    return box;
                },
            });

            this.map.addControl(new control());
        }

        /** Starts on the last choice, or the first option, which is the newest. */
        addRelationPicker(box) {
            const row = L.DomUtil.create('label', 'landmark-context-relation', box);
            const select = L.DomUtil.create('select', '', row);

            select.innerHTML = '<option value="">' + Craft.t('landmark', 'All') + '</option>';
            select.addEventListener('change', () => {
                this.related = select.value ? [Number(select.value)] : [];
                this.remember('related', select.value);
                this.load();
            });

            Craft.sendActionRequest('POST', 'landmark/context/options', { data: { relations: this.config.relations } })
                .then((response) => {
                    const options = (response.data && response.data.options) || [];
                    const saved = this.remembered('related');

                    options.forEach((option) => {
                        const el = document.createElement('option');

                        el.value = option.id;
                        el.textContent = option.title;
                        select.appendChild(el);
                    });

                    const ids = options.map((option) => String(option.id));
                    select.value = saved !== null && (saved === '' || ids.includes(saved)) ? saved : (ids[0] || '');
                    this.related = select.value ? [Number(select.value)] : [];
                    this.load();
                })
                .catch(() => this.load());
        }

        load() {
            const run = (this.run || 0) + 1;
            this.run = run;

            Craft.sendActionRequest('POST', 'landmark/context/shapes', {
                data: {
                    sources: this.config.sources.map((source) => source.uid),
                    relations: this.config.relations,
                    related: this.related,
                    limit: 2000,
                },
            })
                .then((response) => {
                    // A slower answer for an earlier choice is dropped
                    if (run !== this.run) {
                        return;
                    }

                    Object.values(this.sources).forEach((layers) => {
                        layers.forEach((layer) => this.map.removeLayer(layer));
                        layers.length = 0;
                    });

                    ((response.data && response.data.features) || []).forEach((feature) => this.add(feature));
                    this.fit();
                })
                .catch((e) => {
                    console.warn('Landmark: could not load the shapes.', e);
                });
        }

        add(feature) {
            const source = this.config.sources.find((s) => s.uid === feature.properties.source);

            if (!source) {
                return;
            }

            const shapeStyle = { color: source.colour, weight: 1.5, opacity: 0.9, fillColor: source.colour, fillOpacity: 0.2 };
            const pointStyle = { radius: 5, color: '#fff', weight: 1.5, fillColor: source.colour, fillOpacity: 1 };

            L.geoJSON(feature, {
                renderer: this.renderer,
                style: shapeStyle,
                pointToLayer: (point, latlng) => L.circleMarker(latlng, Object.assign({ renderer: this.renderer }, pointStyle)),
            }).getLayers().forEach((layer) => {
                const isPoint = layer instanceof L.CircleMarker;

                layer.bindTooltip(feature.properties.title || source.label, { direction: 'top', sticky: true });
                layer.on('mouseover', () => layer.setStyle(isPoint ? { weight: 3 } : { weight: 3, fillOpacity: 0.35 }));
                layer.on('mouseout', () => layer.setStyle(isPoint ? pointStyle : shapeStyle));
                layer.on('dblclick', (e) => {
                    // Kept from the map, which would otherwise zoom in as well
                    L.DomEvent.stop(e);
                    this.edit(feature.properties);
                });

                this.sources[source.uid].push(layer);

                if (!this.hidden[source.uid]) {
                    layer.addTo(this.map);
                }
            });
        }

        /** Frames the shapes once, on the first load, and leaves the view alone after that. */
        fit() {
            if (this.fitted) {
                return;
            }

            const layers = [].concat(...Object.values(this.sources));

            if (!layers.length) {
                return;
            }

            const bounds = L.featureGroup(layers).getBounds();

            if (bounds.isValid()) {
                this.fitted = true;
                this.map.fitBounds(bounds, { padding: [20, 20], maxZoom: 17, animate: false });
            }
        }

        edit(properties) {
            if (!properties.id) {
                return;
            }

            Craft.createElementEditor('craft\\elements\\Entry', {
                elementId: properties.id,
                siteId: properties.siteId,
                onSaveElement: () => this.load(),
            });
        }
    }

    /** A feature's geometry, carrying whatever its properties said, which are kept against a shape. */
    const geometryIn = (feature) => (feature && feature.geometry
        ? { ...(feature.properties || {}), ...feature.geometry }
        : null);

    function geometryOf(parsed) {
        if (!parsed || typeof parsed !== 'object') {
            return null;
        }

        if (parsed.type === 'FeatureCollection') {
            const geometries = (parsed.features || []).map(geometryIn).filter(Boolean);

            // Every feature is kept, where taking the first would quietly drop the rest
            return geometries.length > 1 ? { type: 'GeometryCollection', geometries } : (geometries[0] ?? null);
        }

        if (parsed.type === 'Feature') {
            return geometryIn(parsed);
        }

        return parsed.coordinates || parsed.geometries ? parsed : null;
    }

    window.Landmark = window.Landmark || {};
    window.Landmark.Field = Field;
    window.Landmark.Overview = Overview;
})();
