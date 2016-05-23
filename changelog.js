var fs = require('fs');
var path = require('path');
var process = require('process');
var execSync = require('child_process').execSync;
var swig = require('swig');
var markdown = require('markdown').markdown;
var versions = {};
var Q = require('q');

/** 
 * Return the git commit hash of the file which created it.
 * @param {String} folder - parent folder of file 
 * @param {String} file - filename of file which should be checked
 */
function getIshOfFile(folder, file) {
	var path = folder + "/" + file;
	var output = execSync('git log --oneline --diff-filter=A --pretty=format:%h -- ' + path);
	getTagOfIsh(output, path, file);
}
var fileRegex = /([^\.]*)\.([^\.]*)\.(.*)/;

/**
 * Determine the first git tag in which the ish occurs and add the found information to the versions object.
 * @param {String} ish - Git commit hash to be checked.
 * @param {String} path - Parent path of the current file.
 * @param {String} file - Current filename.
 */
function getTagOfIsh(ish, path, file) {
	var output = execSync('git tag --format \'{ "tag": "%(refname:short)", "date": "%(authordate)" }\' --contains ' +  ish);
	var infoJSON  = output.toString().split('\n')[0];
	if (infoJSON.length != 0) {
		var info = JSON.parse(infoJSON);
		var content = fs.readFileSync(path, 'utf8');
		var rendered = markdown.toHTML(content);
		info.path = path;
		info.content = content;
		info.contentRendered = rendered;
		var matches = fileRegex.exec(file);
		info.type = matches[2];

		if (typeof versions[info.tag] === 'undefined') {
			versions[info.tag] = {};
		}
		versions[info.tag][file] = info;
	}
}


/**
 * Render the changelog.
 * @param {String} templateFile    - Swig template file which should be used to render the changelog.
 * @param {String} changelogFolder - Folder which contains the git changelog files.
 * @returns a promise
 */
function render(templateFile, changelogFolder) {
	var deferred = Q.defer();

	var files = fs.readdirSync(changelogFolder);
	files.forEach( function(file, index) {
		getIshOfFile(changelogFolder, file);
	});
	var html = swig.renderFile(templateFile, {
		pagename: 'Changelog',
		versions: versions
	});
	deferred.resolve(html);
	return deferred.promise;
}

module.exports  = render;

if (require.main === module) {
	console.log('This script is meant to be used as a library. You probably want to run bin/changelog2html if you\'re looking for a CLI.');
	process.exit(1);
}