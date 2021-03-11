// const SCRATCH_PLUGINS = require('./scratch-plugins');
const ArgumentType = require('../../extension-support/argument-type');
const BlockType = require('../../extension-support/block-type');
const Color = require('../../util/color');
const log = require('../../util/log');
const enhanceRuntime = require('./runtime-extensions');
const StageLayering = require('../../engine/stage-layering');

const makeMenu = dict => Object.values(dict).map(value => ({text: value, value}));

/* const {
    SoundSwap,
    SOUND_SWAP_STATUSES: {
        SS_PLUGIN_STATUS_UPDATE,
        SS_PLUGIN_CHECKING,
        SS_PLUGIN_STARTING,
        SS_PLUGIN_READY,
        SS_PLUGIN_STARTED,
        SS_PLUGIN_STOPPED,
        SS_PLUGIN_NOT_AVAILABLE
    }
} = SCRATCH_PLUGINS;
*/

const SYMBOLS = {
    BENDER_THING: Symbol('BENDER_THING')
};

const SPRITE_PROPS = {
    NAME: 'name',
    TARGET_ID: 'id',
    WIDTH: 'width',
    HEIGHT: 'height',
    DIAGONAL: 'diagonal',
    HIDDEN: 'hidden',
    LAYER: 'layer'
};

class Scratch3BenderBlocks {

    constructor (runtime) {
        this.runtime = runtime;

        // There is no way to get the bender instance from the runtime, so we will need to store it
        runtime.bender = this;

        // wait until the stage is created to punch the runtime
        if (runtime.getTargetForStage()) {
            enhanceRuntime(runtime, this);
        } else {
            runtime.once('TARGETS_UPDATE', () => enhanceRuntime(runtime, this));
        }

        // preview skin vars:
        this._skinId = -1;
        this._skin = null;
        this._drawable = -1;
        this._ghost = 0;
        this._previewCanvas = document.createElement('canvas');
        this._previewCtx = this._previewCanvas.getContext('2d');
        this._setupPreview();

        this.skins = new Map();
        this.skinCount = 0;

        this._stageBackgroundColor = 'transparent';

        log.info('bender blocks', this);
    }

    static get STATE_KEY () {
        return 'Joylabz.bender';
    }

    get scratchPluginEvents () {
        return this.runtime.scratchPluginEvents || {
            emit: function () {},
            on: function () {}
        };
    }

    _startBenderProfile (name = '') {
        if (this.runtime.benderProfile[name]) {
            // eslint-disable-next-line no-console
            console.time(name);
        }
    }

    _endBenderProfile (name = '') {
        if (this.runtime.benderProfile[name]) {
            // eslint-disable-next-line no-console
            console.timeEnd(name);
        }
    }

    getInfo () {
        return {
            id: 'bender',
            name: 'Joylabz Bender',
            menuIconURI: '',
            blockIconURI: '',
            blocks: [
                {
                    opcode: 'whenBooleanHat',
                    text: 'when [BOOLEAN]',
                    blockType: BlockType.HAT,
                    shouldRestartExistingThreads: false,
                    isEdgeActivated: false,
                    arguments: {
                        BOOLEAN: {
                            type: ArgumentType.BOOLEAN,
                            defaultValue: false
                        }
                    }
                },
                {
                    opcode: 'spriteInfo',
                    text: '[PROPERTY] of current sprite',
                    blockType: BlockType.REPORTER,
                    arguments: {
                        PROPERTY: {
                            type: ArgumentType.STRING,
                            defaultValue: SPRITE_PROPS.NAME,
                            menu: 'SPRITE_PROPS'
                        }
                    }
                },
                {
                    opcode: 'touchingAnySprite',
                    text: 'touching any sprite',
                    blockType: BlockType.BOOLEAN,
                    arguments: {}
                },
                {
                    opcode: 'whenGreenFlagOrClone',
                    text: 'when green flag or start as clone',
                    blockType: BlockType.HAT,
                    shouldRestartExistingThreads: false,
                    isEdgeActivated: false
                },
                {
                    opcode: 'broadcastLocal',
                    text: 'self broadcast [MESSAGE]',
                    blockType: BlockType.COMMAND,
                    arguments: {
                        MESSAGE: {
                            type: ArgumentType.STRING,
                            defaultValue: ''
                        }
                    }
                },
                {
                    opcode: 'isDoingMyThing',
                    text: 'is doing my thing?',
                    blockType: BlockType.BOOLEAN,
                    arguments: {}
                },
                {
                    opcode: 'doMyThing',
                    text: 'do my thing for [DELAY] seconds',
                    blockType: BlockType.COMMAND,
                    arguments: {
                        DELAY: {
                            type: ArgumentType.NUMBER,
                            defaultValue: 0.5
                        }
                    }
                },
                {
                    opcode: 'cloneWithThreads',
                    text: 'clone self with running threads',
                    blockType: BlockType.COMMAND,
                    arguments: {}
                },
                {
                    opcode: 'getPixelColor',
                    text: 'get color of pixel at ([X],[Y])',
                    blockType: BlockType.REPORTER,
                    arguments: {
                        X: {
                            type: ArgumentType.NUMBER,
                            defaultValue: 0
                        },
                        Y: {
                            type: ArgumentType.NUMBER,
                            defaultValue: 0
                        }
                    }
                },
                {
                    opcode: 'deleteSelf',
                    text: 'delete self (gamebender only)',
                    blockType: BlockType.COMMAND,
                    arguments: {}
                },
                {
                    opcode: 'setStageBackgroundColor',
                    text: 'set stage background color [COLOR]',
                    blockType: BlockType.COMMAND,
                    arguments: {
                        COLOR: {
                            type: ArgumentType.COLOR
                        }
                    }
                },
                {
                    opcode: 'whenGlitchUndo',
                    text: 'when glitch undo',
                    blockType: BlockType.HAT,
                    shouldRestartExistingThreads: false,
                    isEdgeActivated: false
                },
                /*
                {
                    opcode: 'recordingBooth',
                    text: 'recording booth',
                    blockType: BlockType.COMMAND
                },*/
                {
                    opcode: 'spriteSwap',
                    text: 'swap costumes with [SPRITE_NAME]',
                    blockType: BlockType.COMMAND,
                    arguments: {
                        SPRITE_NAME: {
                            type: ArgumentType.STRING
                        }
                    }
                },
                {
                    opcode: 'codeDropper',
                    text: 'drop blocks from [SPRITE_NAME] into myself',
                    blockType: BlockType.COMMAND,
                    arguments: {
                        SPRITE_NAME: {
                            type: ArgumentType.STRING
                        }
                    }
                }
            ],
            menus: {
                SPRITE_PROPS: makeMenu(SPRITE_PROPS)
            }

        };
    }

    whenGlitchUndo () {
        return true;
    }

    spriteSwap (args, {target}) {
        if (!this.runtime.GAME_BENDER) {
            this.runtime.emit('SAY', target, 'say', 'spriteSwap is only available in GameBender');
            return;
        }

        const originalTargetCostumes = target.sprite.costumes;
        const swapTarget = this.runtime.getSpriteTargetByName(args.SPRITE_NAME);

        // update target with swapTarget costumes
        target.sprite.costumes = swapTarget.sprite.costumes;
        target.setCostume(target.currentCostume);

        // update swapTarget with target costumes
        swapTarget.sprite.costumes = originalTargetCostumes;
        swapTarget.setCostume(swapTarget.currentCostume);
    }

    codeDropper (args, {target}) {
        if (!this.runtime.GAME_BENDER) {
            this.runtime.emit('SAY', target, 'say', 'code dropper is only available in GameBender');
            return;
        }

        const codeTarget = this.runtime.getSpriteTargetByName(args.SPRITE_NAME);

        // if we found a target, and we are not a clone/same target
        if (codeTarget && codeTarget.sprite !== target.sprite) {
            const {threads, pausedThreads = []} = this.runtime;
            const targetBlocks = codeTarget.blocks._blocks;

            target.blocks.forceNoGlow = true;

            // going through the vm block creation helps us
            // avoid lots of unexpected bugs
            const newCopiedBlocks = codeTarget.blocks.duplicate();

            // inject blocks & variables
            target.blocks._blocks = {...target.blocks._blocks, ...newCopiedBlocks._blocks};

            for (const script of newCopiedBlocks._scripts) {
                target.blocks._scripts.push(script);
            }

            target.variables = {...target.variables, ...target.duplicateVariables(newCopiedBlocks)};

            target.blocks.resetCache();

            // start running blocks for target - first
            for (const block of this.findRunningTopBlocks({threads, blocks: targetBlocks})) {
                this.runtime._pushThread(block, target);
            }

            const pausedTopBlocks = this.findRunningTopBlocks({threads: pausedThreads, blocks: targetBlocks});

            if (pausedTopBlocks.length) {
                this.runtime.threads = pausedThreads;
                for (const block of pausedTopBlocks) {
                    // we are using the unedited method from the vm amebender limits threads by
                    // block id during run-script see limitThreadsToBlockIds for more details
                    if (this.runtime.__pushThread) {
                        this.runtime.__pushThread(block, target);
                    } else {
                        this.runtime._pushThread(block, target);
                    }
                }

                this.runtime.threads = threads;
            }

        }
    }
    /*
    recordingBooth (args, {target}) {

        if (!this.runtime.GAME_BENDER) {
            this.runtime.emit('SAY', target, 'say', 'recording booth is only available in GameBender');

            setTimeout(() => {
                this.runtime.emit('SAY', target, 'say', '');
            }, 3000);

            return;
        }

        return new Promise((resolve, reject) => {
            let startUnsubscribe = null;
            let stopUnsubscribe = null;

            this.scratchPluginEvents.emit(SS_PLUGIN_STATUS_UPDATE, SS_PLUGIN_CHECKING);
            const onData = buffer => {
                if (buffer) {
                    // console.log('BOOTH IN SWAP TARGET');
                    for (const player of Object.values(target.sprite.soundBank.soundPlayers)) {
                        player.buffer = buffer;
                        // outputNode copies the buffer set about when it initialize
                        // this is why we need to set its buffer if its been initialized
                        if (player.outputNode) {
                            player.outputNode.buffer = buffer;
                        }
                    }
                }

                if (stopUnsubscribe) {
                    stopUnsubscribe();
                }

                if (startUnsubscribe) {
                    startUnsubscribe();
                }
                // console.log('BOOTH RESOLVE ON DATA');
                resolve();
            };

            const soundSwap = new SoundSwap({onData});

            startUnsubscribe = this.scratchPluginEvents.on(SS_PLUGIN_STARTING, loudnessDelegate => {
                // pass in loudnessDelegate to update loudness state in gamebender
                soundSwap.start(loudnessDelegate);
                this.scratchPluginEvents.emit(SS_PLUGIN_STATUS_UPDATE, SS_PLUGIN_STARTED);
            });

            stopUnsubscribe = this.scratchPluginEvents.on(SS_PLUGIN_STOPPED, () => soundSwap.stop());

            soundSwap.prep()
                .then(() => this.scratchPluginEvents.emit(SS_PLUGIN_STATUS_UPDATE, SS_PLUGIN_READY))
                .catch(() => {
                    this.scratchPluginEvents.emit(SS_PLUGIN_STATUS_UPDATE, SS_PLUGIN_NOT_AVAILABLE);
                    reject();
                });
        });
    }
    */
    setStageBackgroundColor (args) {
        const ctx = this._previewCtx;
        const canvas = this._previewCanvas;
        const [width, height] = this.runtime.renderer.getNativeSize();

        // save the last applied color so its able to get reset after a calibration
        this._stageBackgroundColor = args.COLOR;

        canvas.width = width;
        canvas.height = height;
        ctx.fillStyle = args.COLOR;
        ctx.fillRect(0, 0, width, height);
        this._skin.clear();
        this._skin.drawStamp(canvas, -width / 2, height / 2);
        this.runtime.requestRedraw();
    }

    deleteSelf (args, util) {
        const {target} = util;

        if (target.isOriginal && !this.runtime.GAME_BENDER) {

            this.runtime.emit('SAY', target, 'say', 'would delete in Gamebender');
            setTimeout(() => {
                this.runtime.emit('SAY', target, 'say', '');
            }, 2000);

        } else {
            this.runtime.disposeTarget(target);
            this.runtime.stopForTarget(target);
        }
    }

    getPixelColor (args) {
        const {X, Y} = args;
        // the drawList is front to back so need to reverse it for sampleColor3b
        const drawList = this.runtime.renderer._drawList.slice().reverse();
        const allDrawables = drawList.map(id => {

            const drawable = this.runtime.renderer._allDrawables[id];

            // need this to update the silhouette dirty property on the skin
            // without this we need to click on that canvas to get the updated color
            drawable.updateMatrix();
            drawable.skin.updateSilhouette();

            return {drawable};
        });

        const visibleDrawables = allDrawables.filter(item => item.drawable._visible === true);
        const rgb = this.runtime.renderer.constructor.sampleColor3b([X, Y, 0], visibleDrawables);
        const [r, g, b] = rgb;

        return Color.rgbToHex({r, g, b});
    }

    isDoingMyThing (args, {target}) {
        return Boolean(target[SYMBOLS.BENDER_THING]);
    }

    doMyThing (args, {target}) {
        const delay = Number(args.DELAY);
        // increase next counter
        target[SYMBOLS.BENDER_THING] = (target[SYMBOLS.BENDER_THING] || 0) + 1;

        setTimeout(() => {
            target[SYMBOLS.BENDER_THING]--;
        }, delay * 1000);
    }

    spriteInfo (args, util) {
        const bounds = this.runtime.renderer.getBounds(util.target.drawableID);

        switch (args.PROPERTY) {
        case SPRITE_PROPS.NAME:
            return util.target.sprite.name;
        case SPRITE_PROPS.WIDTH:
            return Math.ceil(bounds.width);
        case SPRITE_PROPS.HEIGHT:
            return Math.ceil(bounds.height);
        case SPRITE_PROPS.DIAGONAL:
            return Math.ceil(Math.hypot(bounds.width, bounds.height));
        case SPRITE_PROPS.HIDDEN:
            return util.target.visible ? 0 : 1;
        case SPRITE_PROPS.TARGET_ID:
            return util.target.id;
        case SPRITE_PROPS.LAYER:
            return this.runtime.renderer._drawList.findIndex(id => id === util.target.drawableID);
        }
    }

    findRunningTopBlocks ({threads, blocks}) {
        const runningBlocks = new Set();

        threads.forEach(thread => {
            if (blocks[thread.topBlock]) {
                runningBlocks.add(thread.topBlock);
            }
        });

        return [...runningBlocks];
    }

    cloneWithThreads (args, util) {
        const newClone = util.target.makeClone();
        if (newClone) {
            this.runtime.addTarget(newClone);
            const runningBlocks = this.findRunningTopBlocks({
                threads: this.runtime.threads,
                blocks: util.target.blocks._blocks
            });

            // filter newly created  thread for cloning
            const filteredRunningBlocks = runningBlocks.filter(topBlock => topBlock !== util.thread.topBlock);

            for (const block of filteredRunningBlocks) {
                this.runtime._pushThread(block, newClone);
            }
        }
    }

    touchingAnySprite (args, util) {
        const target = util.target;
        const otherSprites = this.runtime.targets.filter(t => t !== target && !t.isStage);
        return this.runtime.renderer.isTouchingDrawables(
            target.drawableID, otherSprites.map(({drawableID}) => drawableID)
        );
    }

    whenGreenFlagOrClone () {
        return true;
    }

    whenBooleanHat (args) {
        return args.BOOLEAN;
    }

    broadcastLocal (args, util) {
        const broadcastVar = util.runtime.getTargetForStage().lookupBroadcastMsg(
            null, args.MESSAGE
        );
        if (broadcastVar) {
            const BROADCAST_OPTION = broadcastVar.name;
            util.startHats('event_whenbroadcastreceived', {
                BROADCAST_OPTION
            }, util.target);
        }
    }

    isConnected () {
        return this.client.ready;
    }

    // Implementation Details

    pause () {
        const {runtime} = this;
        if (!runtime.paused) {
            runtime.audioEngine.audioContext.suspend();
            clearInterval(runtime._steppingInterval);
            runtime.paused = true;
        }
    }

    resume () {
        const {runtime} = this;
        if (runtime.paused) {
            runtime.paused = false;
            runtime.audioEngine.audioContext.resume();
            clearInterval(runtime._steppingInterval);
            delete runtime._steppingInterval;
            runtime.start();
        }
    }

    _variableValue (targetVariables, variableID) {

        if (targetVariables[variableID]) {
            return targetVariables[variableID].value;
        }

        const stageVariables = this.runtime.getTargetForStage().variables;

        if (stageVariables[variableID]) {
            return stageVariables[variableID].value;
        }

        return null;
    }

    _setupPreview () {
        const {renderer} = this.runtime;
        if (!renderer) return;

        if (this._skinId === -1 && this._skin === null && this._drawable === -1) {
            this._skinId = renderer.createPenSkin();
            this._skin = renderer._allSkins[this._skinId];
            this._drawable = renderer.createDrawable(StageLayering.VIDEO_LAYER);
            renderer.updateDrawableProperties(this._drawable, {
                skinId: this._skinId,
                ghost: this._ghost
            });
        }

    }
}

module.exports = Scratch3BenderBlocks;
