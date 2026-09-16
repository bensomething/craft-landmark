# Landmark for Craft CMS

Draw markers, lines and shapes on a map in the control panel, stored as GeoJSON.

Landmark adds one field. Draw on the map, or switch to **Coordinates** and type or paste the points in.

> [!NOTE]
> **Landmark is in development.** Settings and stored value formats may still change.

## Requirements

- Craft CMS 5.10 or later
- PHP 8.2 or later
- A Google Cloud API key with the Map Tiles API enabled, for satellite imagery

## Installation

```bash
composer require bensomething/craft-landmark
php craft plugin/install landmark
```

## Settings

In **Settings → Plugins → Landmark**:

- **Basemap**. OpenStreetMap, CARTO or Other.
  - **CARTO** offers its seven raster styles and needs an API key, free from [carto.com](https://carto.com).
  - **Other** takes any Leaflet tile URL, with an optional key. Put `{key}` in the URL where it belongs, or leave it out and the key is added as `key=`. Attribution is yours to set.
- **Google Maps API Key**. Adds a Satellite switch to every field. Leave it empty for the basemap only. Environment variables such as `$GOOGLE_MAPS_API_KEY` work here. Restrict the key to your control panel domain and to the Map Tiles API.
- **Default Latitude**, **Default Longitude**, **Default Zoom**. Where a map opens before anything is drawn.
- **Map Height**.

Each field chooses its own tools (marker, line, shape), whether more than one shape is allowed, and can override the centre, zoom and height.

A field can also draw other entries' shapes behind its own, so you can line things up:

- **Show Shapes From**. Which Landmark fields to draw, each in its own colour, switched on and off from a panel on the map. They can't be edited there.
- **Only From Entries Sharing**. A relation both entries have, such as a Year field, so a field only shows shapes from entries related to the same thing. The editor gets a picker to look at another one. Leave it blank to show them all.
- **Most Shapes To Show**. A cap, 250 by default.

## Usage

Add a **Landmark** field to an entry type, then draw.

```twig
{# GeoJSON geometry, ready for Leaflet #}
{{ entry.area.geoJson }}

{# The same as a Feature, with your own properties #}
{{ entry.area.feature({ name: entry.title })|json_encode|raw }}

{# Coordinates alone, for hand written GeoJSON #}
"geometry": {
    "type": "Polygon",
    "coordinates": [[ {{ entry.area.coordinates }} ]]
}

{# Markers #}
L.marker([{{ entry.pin.lat }}, {{ entry.pin.lng }}]).addTo(map);

{% if entry.area.isEmpty %}Nothing drawn yet{% endif %}
```

## Licence

MIT
