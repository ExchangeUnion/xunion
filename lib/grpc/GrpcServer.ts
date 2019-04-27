import { hostname } from 'os';
import grpc from 'grpc';
import { pki, md } from 'node-forge';
import assert from 'assert';
import Logger from '../Logger';
import GrpcService from './GrpcService';
import Service from '../service/Service';
import errors from './errors';
import { XudService } from '../proto/xudrpc_grpc_pb';
import { HashResolverService } from '../proto/lndrpc_grpc_pb';
import { exists, readFile, writeFile } from '../utils/fsUtils';
import serverProxy from './serverProxy';

class GrpcServer {
  private server: any;
  private grpcService: GrpcService;

  constructor(private logger: Logger, service: Service) {
    this.server = serverProxy(new grpc.Server());

    const grpcService = new GrpcService(logger, service);
    this.server.addService(XudService, {
      addCurrency: grpcService.addCurrency,
      addPair: grpcService.addPair,
      removeOrder: grpcService.removeOrder,
      channelBalance: grpcService.channelBalance,
      connect: grpcService.connect,
      changePassword: grpcService.changePassword,
      ban: grpcService.ban,
      unban: grpcService.unban,
      unlockWallet: grpcService.unlockWallet,
      executeSwap: grpcService.executeSwap,
      estimateFee: grpcService.estimateFee,
      getInfo: grpcService.getInfo,
      genSeed: grpcService.genSeed,
      getNodeInfo: grpcService.getNodeInfo,
      getTransactions: grpcService.getTransactions,
      initWallet: grpcService.initWallet,
      listOrders: grpcService.listOrders,
      listCurrencies: grpcService.listCurrencies,
      listPairs: grpcService.listPairs,
      listPeers: grpcService.listPeers,
      listUnspent: grpcService.listUnspent,
      placeOrder: grpcService.placeOrder,
      placeOrderSync: grpcService.placeOrderSync,
      removeCurrency: grpcService.removeCurrency,
      removePair: grpcService.removePair,
      walletBalance: grpcService.walletBalance,
      shutdown: grpcService.shutdown,
      sendCoins: grpcService.sendCoins,
      sendMany: grpcService.sendMany,
      newAddress: grpcService.newAddress,
      subscribeTransactions: grpcService.subscribeTransactions,
      subscribeOrders: grpcService.subscribeOrders,
      subscribeSwapFailures: grpcService.subscribeSwapFailures,
      subscribeSwaps: grpcService.subscribeSwaps,
    });

    this.server.addService(HashResolverService, {
      resolveHash: grpcService.resolveHash,
    });

    this.grpcService = grpcService;

    this.server.use((ctx: any, next: any) => {
      logger.debug(`received call ${ctx.service.path}`);
      next();
    });
  }

  /**
   * Start the server and begin listening on the provided port
   * @returns true if the server started listening successfully, false otherwise
   */
  public listen = async (port: number, host: string, tlsCertPath: string, tlsKeyPath: string): Promise<boolean> => {
    assert(Number.isInteger(port) && port > 1023 && port < 65536, 'port must be an integer between 1024 and 65535');

    let certificate: Buffer;
    let privateKey: Buffer;

    if (!(await exists(tlsCertPath)) || !(await exists(tlsKeyPath))) {
      this.logger.debug('Could not find gRPC TLS certificate. Generating new one');
      const { tlsCert, tlsKey } = await this.generateCertificate(tlsCertPath, tlsKeyPath);

      certificate = Buffer.from(tlsCert);
      privateKey = Buffer.from(tlsKey);
    } else {
      [certificate, privateKey] = await Promise.all([readFile(tlsCertPath), readFile(tlsKeyPath)]);
    }

    // tslint:disable-next-line:no-null-keyword
    const credentials = grpc.ServerCredentials.createSsl(null,
      [{
        cert_chain: certificate,
        private_key: privateKey,
      }], false);

    const bindCode = this.server.bind(`${host}:${port}`, credentials);
    if (bindCode !== port) {
      const error = errors.COULD_NOT_BIND(port.toString());
      this.logger.error(error.message);
      return false;
    }

    this.server.start();
    this.logger.info(`gRPC server listening on ${host}:${port}`);
    return true;
  }

  /**
   * Stop listening for requests
   */
  public close = (): Promise<void> => {
    this.grpcService.closeStreams();
    return new Promise((resolve) => {
      this.server.tryShutdown(() => {
        this.logger.info('GRPC server completed shutdown');
        resolve();
      });
    });
  }

  /**
   * Generate a new certificate and save it to the disk
   * @returns the cerificate and its private key
   */
  private generateCertificate = async (tlsCertPath: string, tlsKeyPath: string): Promise<{ tlsCert: string, tlsKey: string }> => {
    const keys = pki.rsa.generateKeyPair(1024);
    const cert = pki.createCertificate();

    cert.publicKey = keys.publicKey;
    cert.serialNumber = String(Math.floor(Math.random() * 1024) + 1);

    // TODO: handle expired certificates
    const date = new Date();
    cert.validity.notBefore = date;
    cert.validity.notAfter = new Date(date.getFullYear() + 5, date.getMonth(), date.getDay());

    const attributes = [
      {
        name: 'organizationName',
        value: 'XUD autogenerated certificate',
      },
      {
        name: 'commonName',
        value: hostname(),
      },
    ];

    cert.setSubject(attributes);
    cert.setIssuer(attributes);

    // TODO: add tlsextradomain and tlsextraip options
    cert.setExtensions([
      {
        name: 'subjectAltName',
        altNames: [
          {
            type: 2,
            value: 'localhost',
          },
          {
            type: 7,
            ip: '127.0.0.1',
          },
        ],
      },
    ]);

    cert.sign(keys.privateKey, md.sha256.create());

    const certificate = pki.certificateToPem(cert);
    const privateKey = pki.privateKeyToPem(keys.privateKey);

    await Promise.all([writeFile(tlsCertPath, certificate), writeFile(tlsKeyPath, privateKey)]);
    return {
      tlsCert: certificate,
      tlsKey: privateKey,
    };
  }
}

export default GrpcServer;
