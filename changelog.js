'use strict';

const nodegit = require('nodegit');
const fs = require('fs');
const path = require('path');

module.exports = render;

const fileRegex = /([^\.]*)\.([^\.]*)\.(.*)/;


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
 * @param {String} templateFile    - Swig template file which should be used to render the changelog.
 * @param {String} pathToChangesFolder      - Folder which contains the git changelog files.
 * @returns a promise
 */
function render(templateFile, pathToChangesFolder) {
	const markdown = require('markdown').markdown;
	const swig = require('swig');

	let repo, tags, headHistory, pathInfo;

	return checkFolders(templateFile, pathToChangesFolder)
	.then(info => {
		pathInfo = info;
		return Promise.all([
			nodegit.Repository.open(pathInfo.repoPath)
			.then(repository =>
				Promise.all([
					// We need a commit list of HEAD ...
					repository.getHeadCommit()
						.then(headCommit => getHistoryOfCommit(headCommit))
						.then(history => headHistory = history),
					// ... and all tags in the repo
					getTagCommitsOfRepo(repository)
						.then(tagList => tags = tagList)
				])
				.then(() => repo = repository)
			),
			findFilesInFolder(pathToChangesFolder)
		])
	})
	// Result is [repo, file list]
	.then(result => result[1])
	// Find first tag for each file
	.then(fileList => Promise.all(fileList.map(
		file => {
			return findFirstCommitForFile(headHistory, path.join(pathInfo.changesPath, file))
			.then(commit => {
				return {tag: findFirstTagWithCommit(tags, commit), commit: commit}
			})
			.then(
				tag => ({ fileName: file, firstTag: tag.tag.tagName, fileCommit: tag.commit, tagCommit: tag.tag.headCommit}),
				error => ({ fileName: file, firstTag: null })
			);
		}
	)))
	// If we can not find the history for a file, remove it from the list
	.then(fileList => {
		// Create datastructure which will be used for rendering the template
		let versions = {};
		versions.keys = [];
		fileList.forEach(file => {
			let filePath = path.join(pathToChangesFolder, file.fileName);
			let content = fs.readFileSync(filePath, 'utf8');
			let rendered = markdown.toHTML(content);

			var matches = fileRegex.exec(file.fileName);

			// Add current date to local uncomitted changes
			if (file.firstTag == null) {
				file.firstTag = "pending";
				file.tagCommit = {};
				file.tagCommit.date = function() {
					return	new Date();
				}
				file.fileCommit = {};
				file.fileCommit.date = function() {
					return	new Date();
				}
				file.commit = {};
				file.commit.date = function() {
					return	new Date();
				}
			}

			if (!versions[file.firstTag]) {
				versions.keys.push(file.firstTag);
				versions[file.firstTag] = {
					date: file.tagCommit.date(),
					changes: {}
				};
			}

			versions[file.firstTag]['changes'][file.fileName] = {
				content: content,
				contentRendered: rendered,
				path: filePath,
				date: file.fileCommit.date(),
				tag: file.firstTag,
				type: matches[2]
			};
		});
		return versions;
	})
	.then(renderInfo => {
		renderInfo.keys.sort();
		renderInfo.keys.reverse();
		console.dir(renderInfo.keys);
		let html = swig.renderFile(templateFile, {
				pagename: 'Changelog',
				versions: renderInfo
		});
		return html;
	});
}

function findFirstCommitForFile(repoHeadHistory, filepath) {
	return findAllCommitsForFile(repoHeadHistory, filepath)
	.then(allCommits => {
		allCommits.sort((a, b) => b.date() - a.date());
		return allCommits.length < 1 ? null : allCommits.pop();
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

function findFirstTagWithCommit(tags, commit) {
	// tags is sorted (oldest tag .. newest tag) 
	const commitHash = (typeof commit == 'string') ? commit : commit.sha();
	for (let i = 0; i < tags.length; i++) {
		for (let j = 0; j < tags[i].history.length; j++) {
			if (tags[i].history[j].sha() == commitHash) {
				return tags[i];
			}
		}
	}
	return null;
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
