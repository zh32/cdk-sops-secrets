import * as fs from 'fs';
import { IKey } from 'aws-cdk-lib/aws-kms';
import { ParameterTier, StringParameter } from 'aws-cdk-lib/aws-ssm';
import { ResourceEnvironment, Stack } from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as YAML from 'yaml';
import { SopsStringParameterProps } from './SopsStringParameter';
import {
  CreationType,
  ResourceType,
  SopsSync,
  SopsSyncOptions,
} from './SopsSync';

interface JSONObject {
  [key: string]: any;
}

export interface MultiStringParameterProps extends SopsSyncOptions {
  readonly keySeperator?: string;
}

function flattenJSON(
  data: JSONObject,
  parentKey: string = '',
  result: JSONObject = {},
  keySeparator = '',
): JSONObject {
  for (let key in data) {
    if (data.hasOwnProperty(key)) {
      let newKey = parentKey ? `${parentKey}${keySeparator}${key}` : key;
      if (Array.isArray(data[key])) {
        data[key].forEach((item: JSONObject | null, index: any) => {
          let arrayKey = `${newKey}[${index}]`;
          if (typeof item === 'object' && item !== null) {
            flattenJSON(item, arrayKey, result, keySeparator);
          } else {
            result[arrayKey] = item;
          }
        });
      } else if (typeof data[key] === 'object' && data[key] !== null) {
        flattenJSON(data[key], newKey, result, keySeparator);
      } else {
        result[newKey] = data[key];
      }
    }
  }
  return result;
}

export class MultiStringParameter extends Construct {
  readonly sync: SopsSync;
  readonly encryptionKey: IKey;
  readonly stack: Stack;
  readonly env: ResourceEnvironment;

  constructor(scope: Construct, id: string, props: SopsStringParameterProps) {
    super(scope, id);

    this.encryptionKey = props.encryptionKey;
    this.stack = Stack.of(scope);
    this.env = {
      account: this.stack.account,
      region: this.stack.region,
    };

    const keys = this.parseFile(props.sopsFilePath!).filter(
      (key) => !key.startsWith('sops'),
    );

    keys.forEach((key) => {
      new StringParameter(this, 'Resource' + key, {
        parameterName: key,
        tier: ParameterTier.STANDARD,
        stringValue: ' ',
      });
    });

    this.sync = new SopsSync(this, 'SopsSync', {
      encryptionKey: this.encryptionKey,
      resourceType: ResourceType.PARAMETER,
      creationType: CreationType.MULTI,
      flatten: true,
      flattenSeparator: '/',
      parameterNames: keys,
      ...(props as SopsSyncOptions),
    });
  }

  private parseFile(sopsFilePath: string): string[] {
    const _sopsFileFormat = sopsFilePath.split('.').pop();
    switch (_sopsFileFormat) {
      case 'json': {
        return Object.keys(
          flattenJSON(JSON.parse(fs.readFileSync(sopsFilePath, 'utf-8'))),
        );
      }
      case 'yaml': {
        const content = fs.readFileSync(sopsFilePath, 'utf-8');
        const data = YAML.parse(content) as JSONObject;
        return Object.keys(flattenJSON(data));
      }
      default: {
        throw new Error(
          `Unsupported sopsFileFormat for multiple parameters: ${_sopsFileFormat}`,
        );
      }
    }
  }
}
