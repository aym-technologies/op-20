/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
    assert,
    bsv,
    ByteString,
    byteString2Int,
    ContractTransaction,
    hash256,
    int2ByteString,
    len,
    method,
    MethodCallOptions,
    OpCode,
    prop,
    rshift,
    SigHash,
    slice,
    SmartContract,
    toByteString,
    Utils,
} from 'scrypt-ts'

export class Op20 extends SmartContract {
    @prop(true)
    pow: ByteString

    @prop()
    readonly reward: bigint

    @prop()
    readonly difficulty: bigint

    @prop(true)
    id: ByteString

    @prop(true)
    supply: bigint

    @prop()
    // hex representation of bytes 0-255
    static readonly hexAsciiTable: ByteString = toByteString(
        '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9fa0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebfc0c1c2c3c4c5c6c7c8c9cacbcccdcecfd0d1d2d3d4d5d6d7d8d9dadbdcdddedfe0e1e2e3e4e5e6e7e8e9eaebecedeeeff0f1f2f3f4f5f6f7f8f9fafbfcfdfeff',
        true
    )

    constructor(supply: bigint, reward: bigint, difficulty: bigint) {
        super(...arguments)
        this.supply = supply
        this.reward = reward
        this.difficulty = difficulty
        this.id = toByteString('')
        this.pow = toByteString('')
    }

    @method(SigHash.ANYONECANPAY_ALL)
    public mint(
        nonce: ByteString,
        winner: ByteString,
        trailingOutputs: ByteString
    ) {
        if (this.id == toByteString('')) {
            this.id =
                Op20.txidToAscii(this.ctx.utxo.outpoint.txid) +
                toByteString('_', true) +
                Op20.intToAscii(this.ctx.utxo.outpoint.outputIndex)
        }
        this.pow = this.validatePOW(nonce)
        const reward = this.calculateReward()
        this.supply -= reward
        let stateOutput = toByteString('')
        if (this.supply > 0n) {
            stateOutput = this.buildStateOutput(1n)
            const stateScript = slice(stateOutput, 8n)
            const insScript = Op20.buildInscription(this.id, this.supply)
            stateOutput = Utils.buildOutput(insScript + stateScript, 1n)
        }
        const rewardOutput = Utils.buildOutput(
            winner + Op20.buildInscription(this.id, reward),
            1n
        )

        const outputs: ByteString = stateOutput + rewardOutput + trailingOutputs
        assert(
            hash256(outputs) == this.ctx.hashOutputs,
            `invalid outputs hash ${stateOutput} ${rewardOutput} ${trailingOutputs}`
        )
    }

    @method()
    calculateReward(): bigint {
        let reward = this.reward
        if (this.supply < this.reward) {
            reward = this.supply
        }
        return reward
    }

    @method()
    validatePOW(nonce: ByteString): ByteString {
        const pow = hash256(this.pow + nonce)
        const test = rshift(Utils.fromLEUnsigned(pow), 256n - this.difficulty)
        assert(test == 0n, pow + ' invalid pow')
        return pow
    }

    @method()
    static buildInscription(id: ByteString, amt: bigint): ByteString {
        const json: ByteString = toByteString(
            '{"p":"bsv-20","op":"transfer","id":"',
            true
        )
        id +
            toByteString('","amt":"', true) +
            Op20.intToAscii(amt) +
            toByteString('"}', true)
        return (
            // OP_FALSE OP_IF OP_DATA3 "ord" OP_1 OP_DATA18 "application/bsv-20" OP_0
            toByteString(
                '0063036f726451126170706c69636174696f6e2f6273762d323000'
            ) +
            int2ByteString(len(json)) +
            json +
            OpCode.OP_ENDIF
        )
    }

    @method()
    static intToAscii(num: bigint): ByteString {
        assert(
            num >= 0n && num < 18446744073709551616n,
            'value must be uint64 ' + num
        )
        let ascii = toByteString('', true)
        let done = false
        for (let i = 0; i < 20; i++) {
            if (!done) {
                const char = (num % 10n) + 48n
                ascii = int2ByteString(char) + ascii
                if (num > 9n) {
                    num = num / 10n
                } else {
                    done = true
                }
            }
        }
        return ascii
    }

    @method()
    static txidToAscii(txId: ByteString): ByteString {
        let res = toByteString('')
        for (let i = 0; i < 32; i++) {
            const char = slice(txId, BigInt(i), BigInt(i + 1))
            const pos = byteString2Int(char) * 2n
            res += slice(Op20.hexAsciiTable, pos, pos + 2n)
        }
        return res
    }

    static mintTxBuilder(
        current: Op20,
        options: MethodCallOptions<Op20>,
        nonce: ByteString,
        lock: ByteString,
        trailingOutputs: ByteString
    ): Promise<ContractTransaction> {
        const nextInstance = current.next()
        nextInstance.pow = nextInstance.validatePOW(nonce)
        if (nextInstance.id == toByteString('')) {
            nextInstance.id =
                Op20.txidToAscii(options.fromUTXO!.txId) +
                toByteString('_', true) +
                Op20.intToAscii(BigInt(options.fromUTXO!.outputIndex))
        }

        const reward = nextInstance.calculateReward()
        const inscriptionScript = bsv.Script.fromHex(
            lock + Op20.buildInscription(nextInstance.id, current.reward)
        )
        nextInstance.supply -= reward

        const unsignedTx: bsv.Transaction = new bsv.Transaction()
            // add contract input
            .addInput(current.buildContractInput(options.fromUTXO))
            // build next instance output
            .addOutput(
                new bsv.Transaction.Output({
                    script: nextInstance.lockingScript,
                    satoshis: Number(1),
                })
            )
            // build payment output
            .addOutput(
                new bsv.Transaction.Output({
                    script: inscriptionScript,
                    satoshis: Number(1),
                })
            )

        if (trailingOutputs) {
            unsignedTx.addOutput(
                bsv.Transaction.Output.fromBufferReader(
                    new bsv.encoding.BufferReader(
                        Buffer.from(trailingOutputs, 'hex')
                    )
                )
            )
        }

        return Promise.resolve({
            tx: unsignedTx,
            atInputIndex: 0,
            nexts: [],
        })
    }
}
