# Release Notes for Landmark

## Unreleased

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
