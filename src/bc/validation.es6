/**
 * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */
const { inspect } = require('util')
const {
  all,
  aperture,
  equals
} = require('ramda')

const { getLogger } = require('../logger')
const { blake2bl } = require('../utils/crypto')
const { concatAll } = require('../utils/ramda')
const { BcBlock } = require('../protos/core_pb')
const {
  getChildrenBlocksHashes,
  getChildrenRootHash,
  blockchainMapToList,
  createMerkleRoot,
  prepareWork,
  distance
} = require('./miner')
const GENESIS_DATA = require('./genesis.raw')

const logger = getLogger(__filename)

export function isValidBlock (newBlock: BcBlock): bool {
  return theBlockChainFingerPrintMatchGenesisBlock(newBlock) &&
    numberOfBlockchainsNeededMatchesChildBlock(newBlock) &&
    ifMoreThanOneHeaderPerBlockchainAreTheyOrdered(newBlock) &&
    isChainRootCorrectlyCalculated(newBlock) &&
    isMerkleRootCorrectlyCalculated(newBlock) &&
    isDistanceCorrectlyCalculated(newBlock)
}

function theBlockChainFingerPrintMatchGenesisBlock (newBlock: BcBlock): bool {
  logger.info('theBlockChainFingerPrintMatchGenesisBlock validation running')
  return newBlock.getBlockchainFingerprintsRoot() === GENESIS_DATA.blockchainFingerprintsRoot
}

function numberOfBlockchainsNeededMatchesChildBlock (newBlock: BcBlock): bool {
  logger.info('numberOfBlockchainsNeededMatchesChildBlock validation running')
  // verify that all blockain header lists are non empty and that there is childBlockchainCount of them
  const headerValues = Object.values(newBlock.getBlockchainHeaders().toObject())
  // logger.info(inspect(headerValues, {depth: 3}))
  // $FlowFixMe
  const headerValuesWithLengthGtZero = headerValues.filter(headersList => headersList.length > 0)
  // logger.info(inspect(headerValuesWithLengthGtZero, {depth: 3}))
  // logger.info(GENESIS_DATA.childBlockchainCount)
  return headerValuesWithLengthGtZero.length === GENESIS_DATA.childBlockchainCount
}

function ifMoreThanOneHeaderPerBlockchainAreTheyOrdered (newBlock: BcBlock): bool {
  logger.info('ifMoreThanOneHeaderPerBlockchainAreTheyOrdered validation running')
  const headersMap = newBlock.getBlockchainHeaders()

  // gather true/false for each chain signalling if either there is only one header
  // (most common case) or headers maintain ordering
  const chainsConditions = Object.keys(headersMap.toObject()).map(listName => {
    const getMethodName = `get${listName[0].toUpperCase()}${listName.slice(1)}`
    const chainHeaders = headersMap[getMethodName]()
    if (chainHeaders.length === 1) {
      logger.debug(`ifMoreThanOneHeaderPerBlockchainAreTheyOrdered ${listName} single and valid`)
      return true
    }

    // return true if left height < right height condition is valid
    // for all pairs ([[a, b], [b, c], [c, d]]) of chain headers ([a, b, c, d])
    // (in other words if ordering is maintained)
    const orderingCorrect = all(
      equals(true),
      aperture(2, chainHeaders).map(([a, b]) => a.getHeight() < b.getHeight())
    )
    // $FlowFixMe
    logger.debug(`ifMoreThanOneHeaderPerBlockchainAreTheyOrdered ${listName} multiple and valid: ${orderingCorrect}`)
    if (!orderingCorrect) {
      logger.debug(`ifMoreThanOneHeaderPerBlockchainAreTheyOrdered ${inspect(headersMap.toObject())}`)
    }
    return orderingCorrect
  })

  // check if all chain conditions are true
  logger.info(inspect(chainsConditions))
  return all(equals(true), chainsConditions)
}

function isChainRootCorrectlyCalculated (newBlock: BcBlock): bool {
  logger.info('isChainRootCorrectlyCalculated validation running')
  const receivedChainRoot = newBlock.getChainRoot()

  const expectedBlockHashes = getChildrenBlocksHashes(blockchainMapToList(newBlock.getBlockchainHeaders()))
  const expectedChainRoot = blake2bl(getChildrenRootHash(expectedBlockHashes).toString())
  return receivedChainRoot === expectedChainRoot
}

function isMerkleRootCorrectlyCalculated (newBlock: BcBlock): bool {
  logger.info('isMerkleRootCorrectlyCalculated validation running')
  const receivedMerkleRoot = newBlock.getMerkleRoot()

  const blockHashes = getChildrenBlocksHashes(blockchainMapToList(newBlock.getBlockchainHeaders()))
  const expectedMerkleRoot = createMerkleRoot(concatAll([
    blockHashes,
    newBlock.getTxsList(),
    [newBlock.getMiner(), newBlock.getHeight(), newBlock.getVersion(), newBlock.getSchemaVersion(), newBlock.getNrgGrant()]
  ]))

  return receivedMerkleRoot === expectedMerkleRoot
}

function isDistanceCorrectlyCalculated (newBlock: BcBlock): bool {
  logger.info('isDistanceCorrectlyCalculated validation running')
  const receivedDistance = newBlock.getDistance()

  const expectedWork = prepareWork(newBlock.getPreviousHash(), newBlock.getBlockchainHeaders())
  const expectedDistance = distance(expectedWork, blake2bl(newBlock.getMiner() + newBlock.getMerkleRoot() + blake2bl(newBlock.getNonce()) + newBlock.getTimestamp()))
  return receivedDistance === expectedDistance
}
