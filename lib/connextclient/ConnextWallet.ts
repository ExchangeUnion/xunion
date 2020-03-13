import { CF_PATH } from '@connext/types';
import ethers from 'ethers';

const { fromMnemonic } = ethers.utils.HDNode;

type HDNode = ethers.utils.HDNode.HDNode;

export class ConnextWallet {
  public mainIndex = '0';
  public mnemonic: string;
  public hdNode: HDNode;
  public xpub: string;

  constructor(mnemonic: string) {
    this.mnemonic = mnemonic;
    this.hdNode = fromMnemonic(this.mnemonic).derivePath(CF_PATH);
    this.xpub = this.hdNode.neuter().extendedKey;
  }

  get address(): string {
    return this.hdNode.derivePath(this.mainIndex).address;
  }

  get privateKey(): string {
    return this.hdNode.derivePath(this.mainIndex).privateKey;
  }

  get publicKey(): string {
    return this.hdNode.derivePath(this.mainIndex).publicKey;
  }

  public keyGen(index: string): Promise<string> {
    const res = this.hdNode.derivePath(index);
    return Promise.resolve(res.privateKey);
  }
}
