/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_1464122942")

  // add field
  collection.fields.addAt(10, new Field({
    "hidden": false,
    "id": "file997579739",
    "maxSelect": 1,
    "maxSize": 0,
    "mimeTypes": [],
    "name": "signature_client",
    "presentable": false,
    "protected": false,
    "required": false,
    "system": false,
    "thumbs": [],
    "type": "file"
  }))

  // add field
  collection.fields.addAt(11, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text898912840",
    "max": 0,
    "min": 0,
    "name": "signed_at",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1464122942")

  // remove field
  collection.fields.removeById("file997579739")

  // remove field
  collection.fields.removeById("text898912840")

  return app.save(collection)
})
