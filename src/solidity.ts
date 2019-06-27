import { flatten, uniqBy } from 'lodash';
import path from 'path';

import * as solc from './solc';

export class SoliditySource {
  constructor(
    private readonly contractsDir: string,
    private readonly solcOutput: solc.Output,
  ) { }

  get contracts(): SolidityContract[] {
    return flatten(this.files.map(file => file.contracts));
  }

  get files(): SolidityFile[] {
    return Object.keys(this.solcOutput.sources)
      .map(fileName => this.file(fileName));
  }

  file(fileName: string): SolidityFile {
    return new SolidityFile(
      this,
      this.solcOutput.contracts[fileName],
      this.solcOutput.sources[fileName],
      path.relative(this.contractsDir, fileName),
    );
  }

  contractById(id: number): SolidityContract {
    const contract = this.contracts.find(c => c.astId === id);

    if (contract === undefined) {
      throw new Error(`Contract with id ${id} not found`);
    }

    return contract;
  }
}

class SolidityFile {
  constructor(
    private readonly source: SoliditySource,
    private readonly fileData: solc.FileData,
    private readonly ast: solc.ast.SourceUnit,
    readonly path: string,
  ) { }

  get contracts(): SolidityContract[] {
    return Object.keys(this.fileData).map(contractName =>
      this.contract(contractName)
    );
  }

  contract(contractName: string): SolidityContract {
    const contractData = this.fileData[contractName];

    const astNode = this.ast.nodes.find(n =>
      n.nodeType === 'ContractDefinition' && n.name === contractName
    );

    if (astNode === undefined || contractData === undefined) {
      throw new Error(`Contract ${contractName} not found in ${this.path}`);
    }

    return new SolidityContract(this.source, contractData, astNode, contractName);
  }
}

export class SolidityContract {
  constructor(
    private readonly source: SoliditySource,
    private readonly contractData: solc.ContractData,
    private readonly astNode: solc.ast.ContractDefinition,
    readonly name: string,
  ) { }

  get functions(): SolidityFunction[] {
    return [...this.ownFunctions, ...this.inheritedFunctions];
  }

  get ownFunctions(): SolidityFunction[] {
    return this.astNode.nodes
      .filter(n => n.nodeType === 'FunctionDefinition')
      .map(n => new SolidityFunction(this, n));
  }

  get inheritedFunctions(): SolidityFunction[] {
    return uniqBy(
      flatten(this.baseContracts.map(c => c.functions)),
      f => f.signature,
    );
  }

  get baseContracts(): SolidityContract[] {
    return this.astNode.baseContracts.map(c =>
      this.source.contractById(c.baseName.referencedDeclaration)
    );
  }

  get astId(): number {
    return this.astNode.id;
  }
}

class SolidityFunction {
  constructor(
    private readonly contract: SolidityContract,
    private readonly astNode: solc.ast.FunctionDefinition,
  ) { }

  get name(): string {
    const { name, kind } = this.astNode;
    const isRegularFunction = kind === 'function';
    return isRegularFunction ? name : kind;
  }

  get args(): SolidityTypedVariable[] {
    return this.astNode.parameters.parameters.map(p => ({
      typeName: p.typeName.typeDescriptions.typeString,
    }));
  }

  get signature(): string {
    return `${this.name}(${this.args.map(a => a.typeName).join(',')})`;
  }
}

interface SolidityTypedVariable {
  typeName: string;
}
