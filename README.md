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

Each field chooses its own tools (marker, line, shape, rectangle, circle, dot, label), whether more than one shape is allowed, and can override the centre, zoom and height.

- **Editing Tools**. Which of the toolbar's Edit, Drag, Cut, Remove and Rotate buttons to show. Set once in the plugin settings, and a field can pick its own instead.
- **Tracing**. Lets a picture be dropped on the overview map and lined up against what's underneath, for any field map to draw from. See below.
- A circle, dot or label is stored as a point with its `radius`, `dotRadius` or `text` written against it, since GeoJSON has no room for them. They're drawn back as themselves when the field reopens.

A field can also draw other entries' shapes behind its own, so you can line things up:

- **Show Shapes From**. Which Landmark fields to draw, each in its own colour, switched on and off from a panel on the map. They can't be edited there.
- **Only From Entries Sharing**. A relation both entries have, such as a Year field, so a field only shows shapes from entries related to the same thing. The editor gets a picker to look at another one. Leave it blank to show them all.
- **Most Shapes To Show**. A cap, 250 by default.

### Overview map

Turn on **Overview Map** in the plugin settings to add a **Map** page to the control panel. It shows every shape from a field's **Show Shapes From** sources at once, in their colours, with a picker for its **Only From Entries Sharing** relation. The menu beside the title switches between fields that have sources. Double-click a shape or marker to edit its entry in a slideout, and the map redraws when you save. It needs the Access Landmark permission, and only shows entries you can view.

## Usage

Add a **Landmark** field to an entry type, then draw. Scrolling over a map scrolls the page, as it would anywhere else, and zooming takes Cmd or Ctrl with the wheel.

Pasting GeoJSON into the panel behind the `{}` button takes a geometry, a feature or a whole collection, and what a feature's properties say is kept against its shape.

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

### Tracing a picture

With **Tracing** on, a picture is lined up once on the **Map** page and then drawn from everywhere. Drop it anywhere on the overview map and it lands in the middle at its own proportions. Tick **Edit** to line it up against the shapes underneath:

- Drag a **corner** to resize it, keeping its shape, out from or in towards the far corner.
- Drag a **side** to resize that way only, from the side opposite.
- Drag **anywhere on the picture** to move it.
- Drag **just outside a corner** to turn it.
- Hold **Option** on a corner to pull that corner alone, leaning the picture out of shape, which is how a photograph or a hand drawn map is squared up against what is underneath.

The slider fades it, **Reset** puts it back as it arrived, and **Undo** and **Redo**, or Cmd-Z and Shift-Cmd-Z, step through where it has been. Untick Edit and the picture stops taking the mouse, leaving the drawing tools the map.

There is one picture, whatever the map is filtered by, so lining it up once is enough. Every field map then offers a **Picture** checkbox in its corner, off until it's asked for, which puts the picture under that field's shapes exactly as it was lined up. It can't be moved or replaced there, only drawn over, and none of the tracing code is fetched until the box is ticked.

A picture is kept in the browser it was dropped in. It is never saved with a field, never uploaded, and never seen by anyone else: it is a way of working, not part of the entry.

### Keys on a shape

Anything written against a shape in the field's GeoJSON view is kept through editing and saving:

```json
{ "type": "Polygon", "coordinates": [[ ]], "opacity": 1, "colour": "#f56565" }
```

The field previews `colour` and `opacity` while editing. What any of it means on the front end is for your template to decide.

## Licence

MIT
