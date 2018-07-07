import chai, { expect } from 'chai';
import chaiHttp from 'chai-http';
import Xud from '../../lib/Xud';

describe('WebProxy', () => {
  let xud: Xud;
  let config: any;
  chai.use(chaiHttp);

  before(async () => {
    config = {
      webproxy: {
        disable: false,
        port: 8080,
      },
      lnd: {
        disable: true,
      },
      raiden: {
        disable: true,
      },
      db: {
        database: 'xud_test',
      },
    };

    xud = new Xud(config);
    await xud.start();
  });

  it('should respond with http status 200', (done) => {
    chai.request(`http://localhost:${config.webproxy.port}/api/v1/info`)
                .get('/')
                .end((err, res) => {
                  res.should.have.status(200);
                  expect(res.body.state).to.be.true;
                  res.body.data.should.be.an('object');
                  done();
                });
  });

  after(async () => {
    await xud.shutdown();
  });
});
