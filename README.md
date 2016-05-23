## changelog2html

Yet another changelog tool which uses git to build a html changelog.


The changelog will be generated using a set of changelog files. Each change will be documented in its own changelog file which has a unique filename:


* 7b1f1e4e-1dcf-11e6-b6ba-3e1d05defe79.bugfix.md
* 8b1f1e4e-1dcf-11e6-b6ba-3e1d05defe78.bugfix.md

The files can be added at any time during your development process but i suggest that you add them in combination with your changes.

The changelog2html tool will iterate over these files and determine which git tag effectivly introduced each file. This way a release tag can automatically be linked to each file and thus a version can be assigned to each change. Using this information a swig template will be used to render the changelog.
The changelog content must be markdown. A markdown parser will convert the content to html.

### Workflow

* Create and commit changelog file
* Create regular release and tag your sources using git
* Run changelog2html over your changelog folder to generate your html changelog file

## Install

```bash
$ npm install changelog2html -g
$ changelog2html 
Error: You need to specify the changelog folder

  Usage: changelog2html [options] [Changelog folder]

  Options:

    -h, --help                 output usage information
    -V, --version              output the version number
    -t, --template [template]  Filename of the custom swig template
    -o, --output [output]      HTML output file
```

## Libary usage

```js
changelog = require('changelog-generator');
changelog("template.html", "src/main/changelog").then(function(result) {
  console.log(result);
});
```

Example template:

```html
<h1>{{ pagename|title }}</h1>
<ul>
{% for versionTag, version in versions %}
        <li><h2>{{versionTag}}</h2>
                <p>
                        <ul>
                                {% for change in version %}
                                <li>
                                        <h2>{{change.type}} - {{change.tag}} - {{change.date}}</h2>
                                        <p>{{change.contentRendered|safe}}</p>
                                </li>
                                {% endfor %}
                        </ul>
                </p>
        </li>
{% endfor %}
```

