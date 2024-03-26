const VirtualMachine = require('./virtual-machine');

const ArgumentType = require('./extension-support/argument-type');
const BlockType = require('./extension-support/block-type');
const ScratchStorage = require('scratch-storage');
const ScratchRender = require('scratch-render');
const ScratchAudio = require('scratch-audio');
const ScratchSVGRenderer = require('scratch-svg-renderer');

window.ScratchStorage = ScratchStorage;
window.ScratchRender = ScratchRender;
window.ScratchAudio = ScratchAudio;
window.ScratchSVGRenderer = ScratchSVGRenderer;

module.exports = VirtualMachine;
// TODO: ESM named exports will save us all
module.exports.ArgumentType = ArgumentType;
module.exports.BlockType = BlockType;
