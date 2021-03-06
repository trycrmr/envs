import os from 'os';
import path from 'path';

import { Compiler, CompilerContext, InitAPI, Logger } from './compiler';

import execa from 'execa';
import uuidv4 from 'uuid/v4';
import Vinyl from 'vinyl';

const CONFIG_FILE_NAMES = ['.babelrc', '.babelrc.js', 'babel.config.js'];

const defaultConfig = {
  presets: [['@babel/preset-env']]
};

function presetsToDeps(presets: any) {
  const presetDeps: { [key: string]: string } = {};
  for (let i = 0; i < presets.length; i++) {
    const presetName = presets[i][0];
    if (presetName.startsWith('@babel')) {
      presetDeps[presetName] = '*';
    } else {
      presetDeps[`@babel/${presetName}`] = '*';
    }
  }
  return presetDeps;
}

export class BabelCompiler implements Compiler {
  private _logger: Logger | undefined;

  public init(ctx: { api: InitAPI }) {
    this._logger = ctx.api.getLogger();
    return {
      write: true
    };
  }

  public getDynamicPackageDependencies(ctx: CompilerContext, name?: string) {
    const configFile = ctx.configFiles.find(file => CONFIG_FILE_NAMES.includes(file.name)); // TODO: sort in case of multiple matching config files
    const config = configFile && configFile.contents ? JSON.parse(configFile.contents.toString()) : {};
    const { presets } = config; // TODO: other babel entities
    const presetDeps = presetsToDeps(presets);
    return Object.assign(
      {
        '@babel/cli': '*'
      },
      presetDeps
    );
  }

  public getDynamicConfig(ctx: CompilerContext, name?: string) {
    const configFile = ctx.configFiles.find(file => CONFIG_FILE_NAMES.includes(file.name)); // TODO: sort in case of multiple matching config files
    const config = configFile && configFile.contents ? JSON.parse(configFile.contents.toString()) : {};
    return Object.assign({}, defaultConfig, config || {}, ctx.rawConfig);
  }

  public async action(ctx: CompilerContext) {
    const dists: Vinyl[] = [];
    const targetDir = path.join(os.tmpdir(), `capsule-${uuidv4()}`);
    const res = await ctx.context.isolate({ targetDir, shouldBuildDependencies: true });
    await Promise.all(
      // TODO: make sure this is performant with many-filed components
      ctx.files.map(async (file: any) => {
        const transpileRes = await execa(`babel ${file.basename}`, {
          cwd: targetDir,
          localDir: targetDir,
          preferLocal: true,
          shell: true
        });
        // TODO: handle errors
        const transpiledFile = transpileRes.stdout;
        const dist = new Vinyl({
          path: file.basename, // TODO: proper path
          contents: Buffer.from(transpiledFile),
          base: 'dist' // TODO: ??
        });
        dists.push(dist);
      })
    );
    return { dists };
  }

  get logger(): Logger | undefined {
    return this._logger;
  }
}
