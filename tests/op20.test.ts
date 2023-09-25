/* eslint-disable no-empty */
/* eslint-disable no-constant-condition */
import { expect, use } from 'chai'
import {
    ByteString,
    MethodCallOptions,
    TransactionResponse,
    bsv,
    toByteString,
} from 'scrypt-ts'
import { Op20 } from '../src/contracts/op20'
import { getDefaultSigner, randomPrivateKey } from './utils/txHelper'
import chaiAsPromised from 'chai-as-promised'
import { randomBytes } from 'crypto'
use(chaiAsPromised)

const [priv, pub, , address] = randomPrivateKey()

let op20: Op20
let deployTx: TransactionResponse

describe('Test SmartContract `Op20`', () => {
    before(async () => {
        await Op20.compile()
        op20 = new Op20(1000n, 10n, 8n)
        op20.bindTxBuilder('mint', Op20.mintTxBuilder)
        await op20.connect(getDefaultSigner([priv]))
        deployTx = await op20.deploy(1)
        console.log('OrdinalLock contract deployed: ', deployTx.id)
    })

    it('should pass the mint method when providing solution with valid POW.', async () => {
        let nonce: ByteString
        let counter = 0
        while (true) {
            nonce = toByteString(randomBytes(4).toString('hex'))
            counter++
            try {
                console.log(op20.validatePOW(nonce))
                break
            } catch (e) {}
        }
        console.log('Generated', counter, 'nonces')
        const { tx: callTx, atInputIndex } = await op20.methods.mint(
            nonce,
            toByteString(bsv.Script.fromAddress(address).toHex()),
            toByteString(''),
            {
                fromUTXO: op20.utxo,
                pubKeyOrAddrToSign: [pub],
            } as MethodCallOptions<Op20>
        )

        console.log('callTx: ', callTx.toBuffer().toString('hex'))
        const result = callTx.verifyScript(atInputIndex)
        expect(result.success, result.error).to.eq(true)
    })

    it('should reject the mint method when providing solution with invalid POW.', async () => {
        let nonce: ByteString
        let counter = 0
        while (true) {
            nonce = toByteString(randomBytes(4).toString('hex'))
            counter++
            try {
                console.log(op20.validatePOW(nonce))
            } catch (e) {
                break
            }
        }
        console.log('Generated', counter, 'nonces')
        expect(
            op20.methods.mint(
                nonce,
                toByteString(bsv.Script.fromAddress(address).toHex()),
                toByteString(''),
                {
                    fromUTXO: op20.utxo,
                    pubKeyOrAddrToSign: [pub],
                } as MethodCallOptions<Op20>
            )
        ).to.be.rejectedWith('invalid POW')
    })
})
