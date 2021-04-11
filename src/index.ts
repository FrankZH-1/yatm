import { question } from 'readline-sync';
import { notify } from 'node-notifier';
import { env } from 'process';
import { activeSign, checkInvaild, ISignInQuery, signIn } from './requests';
import { CHECK_ALIVE_INTERVAL, config } from './consts';
import { QRSign } from './QRSign';
import { sleep, pasteFromClipBoard } from './utils';

const extractOpenId = (str: string) =>
  str.length === 32 ? str : str.match('openid=(.*?)(?=&|$)')?.[1];
const sendNotificaition = (message: string) =>
  notify({ message, title: 'yatm' });

const getOpenId = async () => {
  let openId: string | undefined;
  if (config.clipboard?.paste) {
    while (1) {
      const str = pasteFromClipBoard();
      openId = extractOpenId(str);
      if (openId) {
        openId = extractOpenId(str);
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

let lastSignId = 0;
let qrSign: QRSign;

const main = async () => {
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
          qrSign = new QRSign({ courseId, signId });
          const result = await qrSign.start();
          const prompt =
            'Signed in successfully. However, you need to submit new openid!';

          console.log(result);
          signedIdSet.add(signId);

          sendNotificaition(prompt);
          console.warn(prompt);
          openId = '';
          // process.exit(0);
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

let openId = '';

(async () => {
  openId = await getOpenId();
  for (;;) {
    if (!openId.length || (await checkInvaild(openId))) {
      openId = await getOpenId();
      // const prompt = `Error: expired or invaild openId`;
      // sendNotificaition(prompt);
      // throw prompt;
    }
    await main();
    await sleep(config.interval);
  }
})();
