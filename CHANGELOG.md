# Release Notes for Landmark

## 0.3.0 - 2026-09-19

### Fixed

- The Show Shapes From setting's rows are a table now, so a field's name, its toggle and its colour line up with one another.

## 0.2.3 - 2026-09-19

### Added

- A Trace An Image setting, per field. A picture dropped on the map is held under the shapes to draw from, lined up by dragging its corners and sides, turned from just outside a corner, and leaned out of shape by holding Option on one. It fades, steps back and forward, and resets. The picture stays in the browser it was dropped in, against that field on that entry, and is never saved with the field.

## 0.2.2 - 2026-09-19

### Fixed

- A field editing one shape on an entry hid the entry's other shapes as well, so a fence and a boundary drawn on one entry never showed behind each other. Only the field being edited is left out now.
- A layout holding the same field more than once, such as a fence and a boundary drawn on one entry, only ever drew the first of them. Each is drawn now.

## 0.2.1 - 2026-09-19

### Fixed

- The entry a shape's neighbours relate to was left out of the shapes drawn behind a field, so a year holding shapes of its own never showed while filtering by that year. It relates to itself through nothing, and is drawn now.
- A field a layout had renamed was missed by the overview map and by the shapes drawn behind a field, both of which went looking under the field's own handle. Every handle a field goes by is searched now, and an entry is read by the one its own layout uses.
- Pasting a FeatureCollection into the GeoJSON panel kept only its first feature. Every feature is kept now, and what a feature's properties say is kept against its shape.

### Changed

- Scrolling over a map now scrolls the page. Zooming takes Cmd or Ctrl and the wheel, and a hint says so.

## 0.2.0 - 2026-09-18

### Added

- Rectangle, circle, dot and label tools, alongside marker, line and shape. A circle keeps its radius, a dot its size and a label its words, written against the shape.
- An Editing Tools setting for the toolbar's Edit, Drag, Cut, Remove and Rotate buttons, set for every field and overridden per field.

## 0.1.0 - 2026-09-17

### Added

- A Landmark field for drawing markers, lines and shapes, stored as GeoJSON.
- A Coordinates view for typing or pasting points.
- An optional Google satellite layer.
- An optional Esri World Imagery layer, which needs no key.
- A basemap picker: OpenStreetMap, CARTO styles with an API key, or any other tile URL.
- Other entries' shapes can be drawn behind a field's own, filtered by a shared relation. New shapes snap to them.
- Keys written against a shape, such as opacity or colour, are kept. A Shape Opacity setting sets the default.
- Only From Entries Sharing takes more than one relation field, so one field can serve entry types with different ones.
- Shapes can be drawn from one section at a time, each with its own toggle and colour.
- An optional Map page in the control panel, showing every shape from one field's sources, filtered by its relation. Double-clicking a shape opens its entry in a slideout.
