import BufferReader from 'buffer-reader';

import enc from './encryption';
import { remaining } from './bufferreader';
import { UInt53toBufferLE } from './number';

import debug from 'debug';

const logger = debug('hap-client:crypto');

class Cryptographer {
    constructor(encryptKey, decryptKey) {
        this.encryptKey = encryptKey;
        this.decryptKey = decryptKey;

        this.encryptCount = -1;
        this.decryptCount = -1;
    }

    handleRawRequest(req) {
        return this.encrypt(req);
    }

    handleRawResponse(res) {
        return this.decrypt(res);
    }

    encrypt(message) {
        if (this.encryptKey.length > 0) {
            const totalSize = message.length;
            const data = new BufferReader(message);

            let result = Buffer.alloc(0);

            while (remaining.call(data) > 0) {
                // need to encrypt in chunks of size 0x400
                const chunkLength = Math.min(remaining.call(data), 0x400);
                const AAD = Buffer.alloc(2);
                AAD.writeUInt16LE(chunkLength, 0);

                const nonce = UInt53toBufferLE(++this.encryptCount);
                const plainText = data.nextBuffer(chunkLength);

                let [encrypted, hmac] =
                    enc.encryptAndSeal(plainText, AAD, nonce, this.encryptKey);

                result = Buffer.concat([result, AAD, encrypted, hmac]);
            }

            return result;
        }

        return message;
    }

    decrypt(message) {
        if (this.decryptKey.length > 0) {
            const packet = new BufferReader(message);
            const packetSize = remaining.call(packet);

            let result = Buffer.alloc(0);
            while (remaining.call(packet) > 0) {
                const AAD = packet.nextBuffer(2);
                const trueLength = AAD.readUInt16LE(0);
                const availableSize = remaining.call(packet) - 16; // 16 is the size of the HMAC

                logger(`need ${trueLength} bytes and have ${availableSize} bytes`);
                if (trueLength > availableSize) {
                    // The packet is bigger than the available data; wait till more comes in
                    break;
                }

                const nonce = UInt53toBufferLE(++this.decryptCount);
                const cipherText = packet.nextBuffer(trueLength);
                const hmac = packet.nextBuffer(16);

                let decrypted;
                if ((
                    decrypted =
                    enc.verifyAndDecrypt(
                        cipherText, hmac, AAD,
                        nonce, this.decryptKey
                    )
                )) {
                    result = Buffer.concat([result, decrypted]);
                }
                else {
                    logger('decryption failed');
                    logger('packet: %s', packet.buf.toString('hex'));
                    return null;
                }
            }

            return result;
        }

        return message;
    }
}

export {
    Cryptographer as default
}
