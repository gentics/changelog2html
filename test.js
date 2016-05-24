changelog = require("./changelog.js")

changelog("template.html", "changes").then(function(result) {
  console.log(result);
});

/*
changelog(".", "template.html", "../changelog2html/changes").then(function(result) {
  console.log(result);
});
*/