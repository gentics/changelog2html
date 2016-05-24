'use strict';

const nodegit = require('nodegit');
const fs = require('fs');

module.exports = render;

const fileRegex = /([^\.]*)\.([^\.]*)\.(.*)/;

/**
 * Render the changelog.
 * @param {String} templateFile    - Swig template file which should be used to render the changelog.
 * @param {String} pathInRepo      - Folder which contains the git changelog files.
 * @returns a promise
 */
function render(repoPath, templateFile, pathInRepo) {
	const path = require('path');
	const markdown = require('markdown').markdown;
	const swig = require('swig');

	let repo, tags, headHistory;

	// Open repository and list files in folder
	return Promise.all([
		nodegit.Repository.open(repoPath)
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
		findFilesInFolder(path.join(repoPath, pathInRepo))
	])
	// Result is [repo, file list]
	.then(result => result[1])
	// Find first tag for each file
	.then(fileList => Promise.all(fileList.map(
		file => {
			return findFirstCommitForFile(headHistory, path.join(pathInRepo, file))
			.then(commit => {
				return {tag: findFirstTagWithCommit(tags, commit), commit: commit}
			})
			.then(
				tag => ({ fileName: file, firstTag: tag.tag, commit: tag.commit}),
				error => ({ fileName: file, firstTag: null })
			);
		}
	)))
	// If we can not find the history for a file, remove it from the list
	.then(fileList => {
		// Create datastructure which will be used for rendering the template
		let versions = {};
		fileList.forEach(file => {
			let filePath = path.join(pathInRepo, file.fileName);
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
				date: file.commit.date(),
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

function findFirstCommitForFile(repoHeadHistory, filepath) {
	return findAllCommitsForFile(repoHeadHistory, filepath)
	.then(allCommits => {
		allCommits.sort((a, b) => b.date() - a.date());
		return allCommits.length < 1 ? null : allCommits.pop();
	});
}

function findAllCommitsForFile(repoHeadHistory, filepath) {
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

function getTagCommitsOfRepo(repo) {
	// Returns tags of the repo (sorted oldest to newest)
	// with all commits that happened before the tag
	return nodegit.Tag.list(repo)
	.then(tagNames => Promise.all(tagNames.map(tagName =>
		nodegit.Reference.nameToId(repo, 'refs/tags/' + tagName)
		.then(oid => repo.getCommit(oid.tostrS()))
		.then(commit =>
			getHistoryOfCommit(commit)
			.then(history => {
				return { tagName: tagName, headCommit: commit, history: history };
			})
		)
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
				return tags[i].tagName;
			}
		}
	}

	return null;
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
