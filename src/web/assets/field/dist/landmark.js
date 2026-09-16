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

                    const layers = L.control.layers({
                        Map: this.basemap,
                        Satellite: satellite,
                    }, null, { position: 'topright' }).addTo(this.map);

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
                    viewportMargin: Infinity,
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

        draw(geometry, fit) {
            this.layers.clearLayers();

            if (!geometry) {
                return;
            }

            L.geoJSON(geometry).eachLayer((layer) => {
                this.layers.addLayer(layer);
                this.watch(layer);
            });

            if (fit && this.layers.getLayers().length) {
                const bounds = this.layers.getBounds();

                if (bounds.isValid()) {
                    this.map.fitBounds(bounds, { padding: [20, 20], maxZoom: 18 });
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

        geometry() {
            const features = this.layers.toGeoJSON().features || [];

            if (!features.length) {
                return null;
            }

            if (features.length === 1) {
                return features[0].geometry;
            }

            const types = features.map((f) => f.geometry.type);
            const multi = types.every((t) => t === types[0]) ? 'Multi' + types[0] : null;

            if (!multi) {
                return features[0].geometry;
            }

            return {
                type: multi,
                coordinates: features.map((f) => f.geometry.coordinates),
            };
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

            if (!this.allows(geometry.type)) {
                this.setError(Craft.t('landmark', 'This field doesn’t accept {type}.', { type: geometry.type }));
                return;
            }

            this.setError('');
            this.draw(geometry, false);
            this.config.geometry = geometry;
            this.input.value = JSON.stringify(geometry);
        }

        allows(type) {
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

        return parsed.coordinates ? parsed : null;
    }

    window.Landmark = window.Landmark || {};
    window.Landmark.Field = Field;
})();
