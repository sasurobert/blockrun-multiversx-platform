export interface RawNodeInfo {
  agentNonce: number;
  owner: string;
  stakedAmount: string;
  models: string[];
  minStakeRequired: string;
}

export interface NodeInfo {
  agentNonce: number;
  owner: string;
  stakedAmount: string;
  models: string[];
  isStaked: boolean;
}

export type QueryNodeFn = (agentNonce: number) => Promise<RawNodeInfo | null>;

export interface NodeRegistryAdapterOptions {
  identityContractAddress?: string;
  queryNodeFn?: QueryNodeFn;
}

export class NodeRegistryAdapter {
  private queryNodeFn?: QueryNodeFn;

  constructor(options: NodeRegistryAdapterOptions = {}) {
    this.queryNodeFn = options.queryNodeFn;
  }

  public async getNodeInfo(agentNonce: number): Promise<NodeInfo | null> {
    if (!this.queryNodeFn) {
      return {
        agentNonce,
        owner: "erd1mocknode00000000000000000000000000000000000000000000000000",
        stakedAmount: "100000000000000000000",
        models: ["llama-3.3-70b", "deepseek-r1"],
        isStaked: true,
      };
    }

    const raw = await this.queryNodeFn(agentNonce);
    if (!raw) return null;

    let isStaked = false;
    try {
      isStaked = BigInt(raw.stakedAmount) >= BigInt(raw.minStakeRequired);
    } catch {
      isStaked = false;
    }

    return {
      agentNonce: raw.agentNonce,
      owner: raw.owner,
      stakedAmount: raw.stakedAmount,
      models: raw.models,
      isStaked,
    };
  }
}
