// @flow
import * as o2k from 'openapi-2-kong';
import YAML from 'yaml';
import path from 'path';
import type { GlobalOptions } from '../get-options';
import { loadDb } from '../db';
import { loadApiSpec, promptApiSpec } from '../db/models/api-spec';
import { writeFileWithCliOptions } from '../write-file';
import consola from 'consola';

export const ConversionTypeMap: { [string]: ConversionResultType } = {
  kubernetes: 'kong-for-kubernetes',
  declarative: 'kong-declarative-config',
};

export type GenerateConfigOptions = GlobalOptions & {
  type: $Keys<typeof ConversionTypeMap>,
  output?: string,
};

function validateOptions({ type }: GenerateConfigOptions): boolean {
  if (!ConversionTypeMap[type]) {
    const conversionTypes = Object.keys(ConversionTypeMap).join(', ');
    console.log(`Config type "${type}" not unrecognized. Options are [${conversionTypes}].`);
    return false;
  }

  return true;
}

export async function generateConfig(
  identifier: ?string,
  options: GenerateConfigOptions,
): Promise<boolean> {
  if (!validateOptions(options)) {
    return false;
  }

  const { type, output, appDataDir, workingDir, ci } = options;

  const db = await loadDb({ workingDir, appDataDir, filterTypes: ['ApiSpec'] });

  let result: ConversionResult | null = null;

  // try get from db
  const specFromDb = identifier ? loadApiSpec(db, identifier) : await promptApiSpec(db, !!ci);

  if (specFromDb?.contents) {
    consola.trace('Generating config from database contents');
    result = await o2k.generateFromString(specFromDb.contents, ConversionTypeMap[type]);
  } else if (identifier) {
    // try load as a file
    const fileName = path.join(workingDir || '.', identifier);
    consola.trace(`Generating config from file: ${fileName}`);
    try {
      result = await o2k.generate(fileName, ConversionTypeMap[type]);
    } catch (e) {
      consola.error(e);
    }
  }

  if (!result?.documents) {
    consola.log(
      `Unable to load a specification to generate configuration from. Run with --verbose for more information.`,
    );

    return false;
  }

  const yamlDocs = result.documents.map(d => YAML.stringify(d));

  // Join the YAML docs with "---" and strip any extra newlines surrounding them
  const document = yamlDocs.join('\n---\n').replace(/\n+---\n+/g, '\n---\n');

  if (output) {
    const { outputPath, error } = await writeFileWithCliOptions(output, document, workingDir);
    if (error) {
      console.log(`Failed to write to "${outputPath}".\n`, error);
      return false;
    }
    console.log(`Configuration generated to "${outputPath}".`);
  } else {
    console.log(document);
  }

  return true;
}
