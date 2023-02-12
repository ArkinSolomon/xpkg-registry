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
  "dependencies": [
    [
      "arkin.dep2",
      "*"
    ],
    [
      "arkin.dep",
      "*"
    ]
  ],
  "hash": "9D5BE4AB4CD72FEF508B59CE0C530B0F293B63A894F7959F044A89F3E8400467",
  "incompatibilities": [],
  "loc": "https://xpkgregistrydev.s3.us-east-2.amazonaws.com/kGdUldPGyPjXMyzjPfqeBVnfwfAw1Z1s7LMgCiKqSRsdJpBuFOn7Ud0cQ3jq22aS",
  "optionalDependencies": []
}
```