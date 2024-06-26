"use strict";
const events = require("events");
const fs = require("fs-extra");
const JSZip = require("jszip");
const klaw = require("klaw");
const path = require("path");
const yargs = require("yargs");
const child_process = require("child_process");
const util = require("util");


async function exec(file, args) {
	let child = child_process.spawn(file, args, { shell: false, stdio: "inherit" });

	await events.once(child, "exit");
	if (child.exitCode !== 0) {
		throw new Error(`Process exited with code ${child.exitCode}`);
	}
}

async function buildMod(args, info) {
	if (args.build) {
		await fs.ensureDir(args.outputDir);
		let modName = `${info.name}_${info.version}`;

		if (args.pack) {
			let zip = new JSZip();
			let walker = klaw(args.sourceDir)
				.on("data", item => {
					if (item.stats.isFile()) {
						// On Windows the path created uses backslashes as the directory sepparator
						// but the zip file needs to use forward slashes.  We can"t use the posix
						// version of relative here as it doesn"t work with Windows style paths.
						let basePath = path.relative(args.sourceDir, item.path).replace(/\\/g, "/");
						zip.file(path.posix.join(modName, basePath), fs.createReadStream(item.path));
					}
				});
			await events.once(walker, "end");

			for (let [fileName, pathParts] of Object.entries(info.additional_files || {})) {
				let filePath = path.join(args.sourceDir, ...pathParts);
				if (!await fs.pathExists(filePath)) {
					throw new Error(`Additional file ${filePath} does not exist`);
				}
				zip.file(path.posix.join(modName, fileName), fs.createReadStream(filePath));
			}
			delete info.additional_files;

			zip.file(path.posix.join(modName, "info.json"), JSON.stringify(info, null, 4));

			let modPath = path.join(args.outputDir, `${modName}.zip`);
			console.log(`Writing ${modPath}`);
			let writeStream = zip.generateNodeStream().pipe(fs.createWriteStream(modPath));
			await events.once(writeStream, "finish");

		} else {
			let modDir = path.join(args.outputDir, modName);
			if (await fs.exists(modDir)) {
				console.log(`Removing existing build ${modDir}`);
				await fs.remove(modDir);
			}
			console.log(`Building ${modDir}`);
			await fs.copy(args.sourceDir, modDir);
			for (let [fileName, pathParts] of Object.entries(info.additional_files) || []) {
				let filePath = path.join(...pathParts);
				await fs.copy(filePath, path.join(modDir, fileName));
			}
			delete info.additional_files;

			await fs.writeFile(path.join(modDir, "info.json"), JSON.stringify(info, null, 4));
		}
	}
}

async function main() {
	const args = yargs
		.scriptName("build")
		.options({
			"render": { describe: "Render assets", type: "boolean", default: false },
			"post": { describe: "Post process assets", type: "boolean", default: false },
			"clean": { describe: "Remove previous builds", type: "boolean", default: false },
			"build": { describe: "Build mod(s)", type: "boolean", default: true },
			"pack": { describe: "Pack into zip file", type: "boolean", default: true },
			"source-dir": { describe: "Path to mod source directory", nargs: 1, type: "string", default: "mod" },
			"output-dir": { describe: "Path to output built mod(s)", nargs: 1, type: "string", default: "dist" },
			"blender-path": { describe: "Path to blender", type: "string", default: "blender" },
		})
		.argv
		;

	// Warn on modified files being present in the src/ directory.
	let status = await util.promisify(child_process.exec)("git status --porcelain");
	for (let line of status.stdout.split("\n")) {
		if (line.slice(3, 6).startsWith("src")) {
			console.warn(`Warning: ${line.slice(3)} is unclean`);
		}
	}

	if (args.render) {
		await exec(
			args.blenderPath,
			[
				"--background",
				"--python-exit-code", "1",
				path.join("assets", "model.blend"),
				"--python", path.join("assets", "render.py"),
			]
		);
	}

	if (args.post) {
		await exec(
			process.platform === "win32" ? "py" : "python",
			["post.py"],
		);
	}

	let info = JSON.parse(await fs.readFile(path.join(args.sourceDir, "info.json")));
	if (args.clean) {
		let splitter = /^(.*)_(\d+\.\d+\.\d+)(\.zip)?$/;
		for (let entry of await fs.readdir(args.outputDir)) {
			let match = splitter.exec(entry);
			if (match) {
				let [, name, version] = match;
				if (name === info.name) {
					let modPath = path.join(args.outputDir, entry);
					console.log(`Removing ${modPath}`);
					await fs.remove(modPath);
				}
			}
		}
	}

	if (info.variants) {
		for (let [variant, variantOverrides] of Object.entries(info.variants)) {
			let variantInfo = {
				...info,
				...variantOverrides,
			};
			delete variantInfo.variants;
			await buildMod(args, variantInfo);
		}
	} else {
		await buildMod(args, info);
	}
}

if (module === require.main) {
	main().catch(err => {
		console.log(err);
	});
}
