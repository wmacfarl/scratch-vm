const VirtualMachine = require('./virtual-machine');

const ArgumentType = require('./extension-support/argument-type');
const BlockType = require('./extension-support/block-type');
const parser = require('scratch-parser');
const sb3 = require('./serialization/sb3');
VirtualMachine.sb3 = sb3;
VirtualMachine.parser = parser;

module.exports = VirtualMachine;

// TODO: ESM named exports will save us all
module.exports.ArgumentType = ArgumentType;
module.exports.BlockType = BlockType;
