# X-Pkg Registery

## Paths

### */packages*

Get all of the packages in JSON format. Sample response:

```JSON
{
  "data": [
    {
      "packageId": "author.package_id",
      "packageName": "A package",
      "authorName": "author",
      "description": "A package",
      "versions": [
        "1.0.0",
        "1.2.1",
        "1.3.4",
        "1.0.7"
      ]
    }
  ]
}
```

### */packages/:packageId/:version*

Get the hash and location for a package with a specific version. The `packageId` parameter should be the id of the package, and the `version` parameter should be the version of the pacakge. Sample response:

```JSON
{
  "loc": "https://s3.aws.org/bucket/url/thingy/whatever/",
  "hash": "0x711CF6C58791CD9BFEE0320C1E0DF98DAEC1ACD698628080920525D8E7189398"
}
```