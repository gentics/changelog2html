changelog = require("./changelog.js")

changelog(".", "template.html", "changes").then(function(result) {
  console.log(result);
});

