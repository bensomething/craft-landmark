/* global L, Craft, CodeMirror */

(function() {
    'use strict';

    const ALLOWED = {
        marker: ['Point', 'MultiPoint'],
        line: ['LineString', 'MultiLineString'],
        polygon: ['Polygon', 'MultiPolygon'],
    };

    class Field {
        constructor(id, config) {
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
                scrollWheelZoom: 'center',
            });

            this.basemap = L.tileLayer(c.basemapUrl, {
                attribution: c.basemapAttribution,
                maxZoom: 22,
                maxNativeZoom: 20,
            }).addTo(this.map);

            this.layers = L.featureGroup().addTo(this.map);
            this.watchSize();
            this.draw(c.geometry, true);

            if (!this.map.pm) {
                console.error('Landmark: Leaflet-Geoman did not load, so there are no drawing tools.');
                return;
            }

            this.map.pm.addControls(Object.assign({
                position: 'topleft',
                editMode: true,
                dragMode: true,
                removalMode: true,
                rotateMode: true,
                cutPolygon: false,
                drawCircle: false,
                drawCircleMarker: false,
                drawRectangle: false,
                drawText: false,
            }, this.drawTools()));

            this.map.pm.setGlobalOptions({ snappable: true, snapDistance: 15 });

            this.map.on('pm:create', (e) => {
                if (!this.config.allowMultiple) {
                    this.layers.eachLayer((layer) => {
                        if (layer !== e.layer) {
                            this.layers.removeLayer(layer);
                        }
                    });
                }
                this.layers.addLayer(e.layer);
                this.preview(e.layer, {});
                this.watch(e.layer);
                this.sync();
            });

            this.map.on('pm:remove', () => this.sync());

            if (this.config.hasSatellite) {
                this.initSatellite();
            }
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

        drawTools() {
            const shapes = this.config.shapes || [];

            return {
                drawMarker: shapes.includes('marker'),
                drawPolyline: shapes.includes('line'),
                drawPolygon: shapes.includes('polygon'),
            };
        }

        initSatellite() {
            Craft.sendActionRequest('POST', 'landmark/tiles/session')
                .then((response) => {
                    const data = response.data || {};

                    if (!data.tileUrl) {
                        console.warn('Landmark: no satellite layer. ' + (data.error || ''));
                        return;
                    }

                    const satellite = L.tileLayer(data.tileUrl, {
                        attribution: data.attribution,
                        maxZoom: 22,
                        maxNativeZoom: 20,
                    });

                    // The radios are kept out of the entry form. They appear after Craft
                    // has read it, which it would otherwise save as an unsaved change.
                    const Layers = L.Control.Layers.extend({
                        _createRadioElement(name, checked) {
                            const input = L.Control.Layers.prototype._createRadioElement.call(this, name, checked);

                            input.setAttribute('form', 'landmark-detached');

                            return input;
                        },
                    });

                    const layers = new Layers({
                        Map: this.basemap,
                        Satellite: satellite,
                    }, null, { position: 'topright' }).addTo(this.map);

                    if (this.remembered('basemap') === 'Satellite') {
                        this.map.removeLayer(this.basemap);
                        this.map.addLayer(satellite);
                    }

                    this.map.on('baselayerchange', (e) => this.remember('basemap', e.name));

                    const toggle = layers.getContainer().querySelector('.leaflet-control-layers-toggle');

                    if (toggle) {
                        toggle.classList.add('landmark-layers-toggle');
                        toggle.innerHTML = this.icon('layers');
                    }
                })
                .catch((e) => {
                    console.warn('Landmark: no satellite layer.', e);
                });
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

        /** What this field remembers between entries, kept under its own name. */
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
                L.geoJSON(shape).getLayers().forEach((layer) => unpack(layer, this.extras(shape)));
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

        watch(layer) {
            ['pm:edit', 'pm:dragend', 'pm:rotateend', 'pm:markerdragend'].forEach((event) => {
                layer.on(event, () => this.sync());
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

    function geometryOf(parsed) {
        if (!parsed || typeof parsed !== 'object') {
            return null;
        }

        if (parsed.type === 'FeatureCollection') {
            return (parsed.features || []).length ? parsed.features[0].geometry : null;
        }

        if (parsed.type === 'Feature') {
            return parsed.geometry || null;
        }

        return parsed.coordinates || parsed.geometries ? parsed : null;
    }

    window.Landmark = window.Landmark || {};
    window.Landmark.Field = Field;
})();
