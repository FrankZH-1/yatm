import { question } from 'readline-sync';
import { env } from 'process';
import { activeSign, checkInvaild, ISignInQuery, signIn } from './requests';
import { CHECK_ALIVE_INTERVAL, config } from './consts';
import { QRSign } from './QRSign';
import {
  extractOpenId,
  sendNotificaition,
  sleep,
  pasteFromClipBoard,
} from './utils';
import { WechatDevtools } from './cdp';

let devtools: WechatDevtools;

const getOpenId = async () => {
  let openId: string | undefined;
  if (config.devtools) {
    openId = await devtools.generateOpenId();
  } else if (config.clipboard?.paste) {
    while (true) {
      openId = extractOpenId(pasteFromClipBoard());
      if (openId) {
        if (openIdSet.has(openId)) {
          continue;
        }
        openIdSet.add(openId);
        break;
      }
      await sleep(config.wait);
    }
  } else {
    openId = extractOpenId(
      env.OPEN_ID ?? question('Paste openId or URL here: ')
    );
  }
  if (!openId) {
    throw 'Error: invalid openId or URL';
  }
  return openId;
};

const signedIdSet = new Set<number>();
const openIdSet = new Set<string>();

let lastSignId = 0;
let qrSign: QRSign;

const main = async (
  openId: string,
  setOpenId: (openId: string) => void,
  devtools?: WechatDevtools
) => {
  return await activeSign(openId)
    .then(async (data) => {
      if (!data.length) {
        qrSign?.destory();
        throw 'No sign-in available';
      }
      const queue = [
        ...data.filter((sign) => !sign.isQR),
        ...data.filter((sign) => sign.isQR),
      ];

      for (const sign of queue) {
        const { signId, courseId, isGPS, isQR, name } = sign;
        console.log('current sign-in:', sign.name);

        if (signedIdSet.has(signId)) {
          throw `${name} already signed in`;
        }

        sendNotificaition(`INFO: ${name} sign-in is going on!`);

        if (isQR) {
          if (signId === lastSignId) {
            return;
          }
          lastSignId = signId;
          sendNotificaition(`WARNING: ${name} QR sign-in is going on!`);
          qrSign?.destory();
          qrSign = new QRSign({ courseId, signId, setOpenId, devtools });
          const result = await qrSign.start();

          signedIdSet.add(signId);
          console.log(result);

          if (!config.devtools) {
            const prompt =
              'Signed in successfully. However, you need to submit new openid!';
            sendNotificaition(prompt);
            console.warn(prompt);
            setOpenId('');
          }
          qrSign?.destory();
        } else {
          let signInQuery: ISignInQuery = { courseId, signId };
          if (isGPS) {
            const { lat, lon } = config;
            signInQuery = { ...signInQuery, lat, lon };
          }
          await sleep(config.wait);
          await signIn(openId, signInQuery)
            .then((data) => {
              if (!data.errorCode || data.errorCode === 305) {
                signedIdSet.add(signId);
              }
              console.log(data);
            })
            .catch((e) => {
              console.log(e);
              sendNotificaition(
                `Error: failed to ${name} sign in. See output plz.`
              );
            });
        }
      }
    })
    .catch((e) => {
      console.log(e);
    });
};

(async () => {
  let openId = '';
  let devtools: WechatDevtools | undefined = undefined;
  if (config.devtools) {
    devtools = new WechatDevtools();
    await devtools.init();
    openId = (await devtools.generateOpenId())!;
    console.log(openId);
  }
  for (;;) {
    if (!openId.length || (await checkInvaild(openId))) {
      let prompt = 'Error: expired or invaild openId!';
      if (config.clipboard) {
        prompt = `${prompt} Waiting for new openId from clipboard...`;
      }
      sendNotificaition(prompt);
      console.warn(prompt);
      if (!openIdSet.has(openId)) {
        openIdSet.add(openId);
      }
      openId = await getOpenId();
    }
    await main(openId, (newId) => (openId = newId), devtools);
    await sleep(config.interval);
  }
})();
