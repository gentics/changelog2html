'use strict';

const nodegit = require('nodegit');
const fs = require('fs');
const path = require('path');

module.exports = render;

const fileRegex = /([^\.]*)\.([^\.]*)\.(.*)/;

const debug = require('debug');
let error = debug('app:error');
let log = debug('app:log');



function checkFolders(templateFile, pathToChangesFolder) {
	var filepath = path.resolve(process.cwd(),pathToChangesFolder);
	//console.log("Rendering changelog for repo in {" + repoPath + "} using template {" + templateFile + "}");
	//console.log("Checking change files in {" + pathInRepo + "}");
	return checkPath(templateFile, false, "Could not find template file {" + templateFile + "}")
	.then(e => checkPath(pathToChangesFolder, true, "Could not find changes folder {" + pathToChangesFolder + "}"))
	.then(e => nodegit.Repository.discover(pathToChangesFolder, 100, ""))
	.then(buf => {
		let workspaceFolderPath = path.resolve(buf.toString(), "..");
		let pathToChangesWithinRepo = path.relative(workspaceFolderPath, filepath);
		return {
			'repoPath':	buf.toString(),
			'workspacePath': workspaceFolderPath,
			'changesPath': pathToChangesWithinRepo
		}
		//.then(e => checkPath(repoPath, true, "Could not find repository folder {" + repoPath +"}"))
	});
}

/**
 * Render the changelog.
 * @param {String} templateFile    		- Swig template file which should be used to render the changelog.
 * @param {String} pathToChangesFolder  - Folder which contains the git changelog files.
 * @returns a promise
 */
function render(templateFile, pathToChangesFolder) {
	const markdown = require('markdown').markdown;
	const swig = require('swig');

	let repo, tags, headHistory, pathInfo;

	return checkFolders(templateFile, pathToChangesFolder)
	.then(info => {
		pathInfo = info;
	})
	.then(() => nodegit.Repository.open(pathInfo.repoPath))
	.then(repository => {
		return Promise.all([findFilesInFolder(pathToChangesFolder), getTagCommitsOfRepo(repository)])
	})
	.then(info => {
		let files = info[0];
		let tags  = info[1];
		return Promise.all(files.map(file => {
			return tags.map(tagInfo => {
				//log("Found {" + tagList.length +"} commits for tag {" + tagList.tagName + "}");
				log("Checking file {" + file +"} for tag {" + tagInfo.tagName +"}");
				return findFirstCommitForFile(tagInfo.history, path.join(pathInfo.changesPath, file))
				.then(
					commit => ({ fileName: file, firstTag: tagInfo.tagName, commit: commit}),
					error => ({ fileName: file, firstTag: null })
				);
				
			});
		}));
	})
	// If we can not find the history for a file, remove it from the list
	.then(fileList => {
		log("List", fileList);
		// Create datastructure which will be used for rendering the template
		let versions = {};
		fileList.forEach(file => {
			log("Preparing file info for file {" +file.fileName + "} with tag {" + file.firstTag + "}");
			let filePath = path.join(pathToChangesFolder, file.fileName);
			let content = fs.readFileSync(filePath, 'utf8');
			let rendered = markdown.toHTML(content);

			if (!versions[file.firstTag]) {
				versions[file.firstTag] = {};
			}
			var matches = fileRegex.exec(file.fileName);
			versions[file.firstTag][file.fileName] = {
				content: content,
				contentRendered: rendered,
				path: filePath,
				//date: file.commit.date(),
				tag: file.firstTag,
				type: matches[2]
			};
		});
		return versions;
	})
	.then(renderInfo => {
		let html = swig.renderFile(templateFile, {
				pagename: 'Changelog',
				versions: renderInfo
		});
		return html;
	})
	.catch(console.error.bind(console));
	


}

function findFirstCommitForFile(history, filepath) {
	//log("Checking {" + history.length + "} commits for file {" + filepath + "}");
	return findAllCommitsForFile(history, filepath)
	.then(allCommits => {
		//log("Found {" + allCommits.length+ "} commits that include file {" + filepath + "}");
		allCommits.sort((a, b) => b.date() - a.date());
		return allCommits.length < 1 ? null : allCommits.pop();
	}).then(commit => {
		//log("Found earliest commit {"+commit.sha()+"} for file {" + filepath +"}");
		return commit;
	});
}

function findAllCommitsForFile(repoHeadHistory, filepath) {
	//console.log(filepath);
	return Promise.all(
		repoHeadHistory.map(
			commit => commit.getEntry(filepath)
			.then(
				entry => commit,
				fail => null
			)
		)
	)
	.then(commitList => commitList.filter(entry => entry != null));
}

/**
 * Returns tags of the repo (sorted oldest to newest)
 * with all commits that happened before the tag.
 *
 * @returns a promise which contains an array in form of [{tagName, headCommit, history}]
 */
function getTagCommitsOfRepo(repo) {
	
	return nodegit.Tag.list(repo)
	.then(tagNames => Promise.all(tagNames.map(tagName => {
		//log("Loading commit for tag {" + tagName+ "}");
		return nodegit.Reference.nameToId(repo, 'refs/tags/' + tagName)
		.then(oid => {	
			return repo.getCommit(oid.tostrS()).catch(err => {
				//log("Tag {" + tagName +"} seems to be annotated tag. Applying fallback.");
				return repo.getTag(oid.tostrS()).then(tag => {
					return repo.getCommit(tag.target().id().tostrS());
				});
			});
		})
		.then(commit => {
			//log("Found commit {" + commit.sha()+"} for tag {" + tagName + "}");
			return getHistoryOfCommit(commit).then(history => {
				//log("Found {" + history.length +"} commits for tag {" + tagName + "}");
				return { tagName: tagName, headCommit: commit, history: history };
			})
		}
		)}
	)))
	.then(tagList => tagList.sort(
		(a, b) => a.headCommit.date() - b.headCommit.date()
	));
}

function getHistoryOfCommit(headCommit) {
	return new Promise(resolve => {
		let history = headCommit.history();
		let commits = [];
		history.on('commit', commit => commits.push(commit));
		history.on('end', () => resolve(commits));
		history.start();
	});
}

function checkPath(path, expectFolder, failureMessage) {
	return new Promise((success, fail) => {
		fs.stat(path, (err, stats) => {
			if (err) {
				return fail(failureMessage, err);
			} else {
				if (expectFolder && !stats.isDirectory()) {
					return fail(failureMessage);
				}
				if (!expectFolder && !stats.isFile()) {
					return fail(failureMessage);
				}
 				return success(null);
			}
		});
	});
}

function findFilesInFolder(folder) {
	const fs = require('fs');
	return new Promise((success, fail) => {
		fs.readdir(folder, (err, fileList) => {
			if (err) {
				return fail(err);
			} else {
				return success(fileList);
			}
		});
	});
}

if (require.main === module) {
	console.log('This script is meant to be used as a library. You probably want to run bin/changelog2html if you\'re looking for a CLI.');
	process.exit(1);
}
