## changelog-generator

## Install

```bash
$ npm install git+ssh://git@git.gentics.com:psc/changelog-generator.git#master
```

## Usage

```js
changelog = require('changelog-generator');
html = changelog("template.html", "src/main/changelog");
console.log(html);
```
