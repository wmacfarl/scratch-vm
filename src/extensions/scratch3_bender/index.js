// const SCRATCH_PLUGINS = require('./scratch-plugins');
const ArgumentType = require("../../extension-support/argument-type");
const BlockType = require("../../extension-support/block-type");
const Color = require("../../util/color");
const log = require("../../util/log");
const enhanceRuntime = require("./runtime-extensions");

const makeMenu = (dict) =>
    Object.values(dict).map((value) => ({ text: value, value }));

const SPRITE_PROPS = {
    NAME: "name",
    TARGET_ID: "id",
    WIDTH: "width",
    HEIGHT: "height",
    DIAGONAL: "diagonal",
    HIDDEN: "hidden",
    LAYER: "layer",
};

class Scratch3BenderBlocks {
    constructor(runtime) {
        this.runtime = runtime;
        this.runtime.deleteTarget = this.deleteTarget.bind(this);
        // There is no way to get the bender instance from the runtime, so we will need to store it
        runtime.bender = this;

        // wait until the stage is created to punch the runtime
        if (runtime.getTargetForStage()) {
            enhanceRuntime(runtime, this);
        } else {
            runtime.once("TARGETS_UPDATE", () => enhanceRuntime(runtime, this));
        }

        this.skins = new Map();
        this.skinCount = 0;

        this._stageBackgroundColor = "transparent";

        log.info("bender blocks", this);
    }
    getInfo() {
        return {
            id: "bender",
            name: "Joylabz Bender",
            menuIconURI: "",
            blockIconURI: "",
            blocks: [
                {
                    opcode: "whenBooleanHat",
                    text: "when [BOOLEAN]",
                    blockType: BlockType.HAT,
                    shouldRestartExistingThreads: false,
                    isEdgeActivated: false,
                    arguments: {
                        BOOLEAN: {
                            type: ArgumentType.BOOLEAN,
                            defaultValue: false,
                        },
                    },
                },
                {
                    opcode: "spriteInfo",
                    text: "[PROPERTY] of current sprite",
                    blockType: BlockType.REPORTER,
                    arguments: {
                        PROPERTY: {
                            type: ArgumentType.STRING,
                            defaultValue: SPRITE_PROPS.NAME,
                            menu: "SPRITE_PROPS",
                        },
                    },
                },
                {
                    opcode: "touchingAnySprite",
                    text: "touching any sprite",
                    blockType: BlockType.BOOLEAN,
                    arguments: {},
                },
                {
                    opcode: "whenGreenFlagOrClone",
                    text: "when green flag or start as clone",
                    blockType: BlockType.HAT,
                    shouldRestartExistingThreads: false,
                    isEdgeActivated: false,
                },
                {
                    opcode: "whenGlitchRemoved",
                    text: "when glitch removed",
                    blockType: BlockType.HAT,
                    shouldRestartExistingThreads: false,
                    isEdgeActivated: false,
                },
                {
                    opcode: "broadcastLocal",
                    text: "self broadcast [MESSAGE]",
                    blockType: BlockType.COMMAND,
                    arguments: {
                        MESSAGE: {
                            type: ArgumentType.STRING,
                            defaultValue: "",
                        },
                    },
                },
                {
                    opcode: "cloneWithThreads",
                    text: "clone self with running threads",
                    blockType: BlockType.COMMAND,
                    arguments: {},
                },
                {
                    opcode: "getPixelColor",
                    text: "get color of pixel at ([X],[Y])",
                    blockType: BlockType.REPORTER,
                    arguments: {
                        X: {
                            type: ArgumentType.NUMBER,
                            defaultValue: 0,
                        },
                        Y: {
                            type: ArgumentType.NUMBER,
                            defaultValue: 0,
                        },
                    },
                },
                {
                    opcode: "deleteSelf",
                    text: "delete self (gamebender only)",
                    blockType: BlockType.COMMAND,
                    arguments: {},
                },
                {
                    opcode: "setStageBackgroundColor",
                    text: "set stage background color [COLOR]",
                    blockType: BlockType.COMMAND,
                    arguments: {
                        COLOR: {
                            type: ArgumentType.COLOR,
                        },
                    },
                },
                {
                    opcode: "spriteSwap",
                    text: "swap costumes with [SPRITE_NAME]",
                    blockType: BlockType.COMMAND,
                    arguments: {
                        SPRITE_NAME: {
                            type: ArgumentType.STRING,
                        },
                    },
                },
                {
                    opcode: "codeDropper",
                    text: "drop blocks from [SPRITE_NAME] into myself",
                    blockType: BlockType.COMMAND,
                    arguments: {
                        SPRITE_NAME: {
                            type: ArgumentType.STRING,
                        },
                    },
                },
            ],
            menus: {
                SPRITE_PROPS: makeMenu(SPRITE_PROPS),
            },
        };
    }

    spriteSwap(args, { target }) {
        if (!this.runtime.GAME_BENDER) {
            this.runtime.emit(
                "SAY",
                target,
                "say",
                "spriteSwap is only available in GameBender"
            );
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

    codeDropper(args, { target }) {
        if (!this.runtime.GAME_BENDER) {
            this.runtime.emit(
                "SAY",
                target,
                "say",
                "code dropper is only available in GameBender"
            );
            return;
        }

        const codeTarget = this.runtime.getSpriteTargetByName(args.SPRITE_NAME);

        // if we found a target, and we are not a clone/same target
        if (codeTarget && codeTarget.sprite !== target.sprite) {
            const { threads, pausedThreads = [] } = this.runtime;
            const targetBlocks = codeTarget.blocks._blocks;

            target.blocks.forceNoGlow = true;

            // going through the vm block creation helps us
            // avoid lots of unexpected bugs
            const newCopiedBlocks = codeTarget.blocks.duplicate();

            // inject blocks & variables
            target.blocks._blocks = {
                ...target.blocks._blocks,
                ...newCopiedBlocks._blocks,
            };

            for (const script of newCopiedBlocks._scripts) {
                target.blocks._scripts.push(script);
            }

            target.variables = {
                ...target.variables,
                ...target.duplicateVariables(newCopiedBlocks),
            };

            target.blocks.resetCache();

            // start running blocks for target - first
            for (const block of this.findRunningTopBlocks({
                threads,
                blocks: targetBlocks,
            })) {
                this.runtime._pushThread(block, target);
            }

            const pausedTopBlocks = this.findRunningTopBlocks({
                threads: pausedThreads,
                blocks: targetBlocks,
            });

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

    setStageBackgroundColor(args) {
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

    deleteTarget(target) {
        // delete target does the following:
        // if it is a clone, it will be removed from the runtime
        // if it is the original and there are no clones, it will be removed from the runtime
        // if it is the original and there are clones, it will be hidden and marked as destroyed
        // if it is the stage, nothing will happen
        if (target.isStage) {
            return;
        }

        if (target.isOriginal) {
            if (target.sprite.clones.length === 1) {
                this.runtime.stopForTarget(target);
                this.runtime.disposeTarget(target);
            } else {
                target.isDestroyed = true;
                target.setVisible(false);
            }
        } else {
            if (
                target.sprite.clones.length === 2 &&
                target.sprite.clones[0].isDestroyed
            ) {
                this.runtime.stopForTarget(target.sprite.clones[0]);
                this.runtime.disposeTarget(target.sprite.clones[0]);
            }
            this.runtime.stopForTarget(target);
            this.runtime.disposeTarget(target);
        }
    }

    deleteSelf(args, util) {
        const { target } = util;
        if (target.isStage) {
            return;
        }
        this.deleteTarget(target);
    }
    getPixelColor(args) {
        const { X, Y } = args;
        // the drawList is front to back so need to reverse it for sampleColor3b
        const drawList = this.runtime.renderer._drawList.slice().reverse();
        const allDrawables = drawList.map((id) => {
            const drawable = this.runtime.renderer._allDrawables[id];

            // need this to update the silhouette dirty property on the skin
            // without this we need to click on that canvas to get the updated color
            drawable.updateMatrix();
            drawable.skin.updateSilhouette();

            return { drawable };
        });

        const visibleDrawables = allDrawables.filter(
            (item) => item.drawable._visible === true
        );
        const rgb = this.runtime.renderer.constructor.sampleColor3b(
            [X, Y, 0],
            visibleDrawables
        );
        const [r, g, b] = rgb;

        return Color.rgbToHex({ r, g, b });
    }

    spriteInfo(args, util) {
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
                return this.runtime.renderer._drawList.findIndex(
                    (id) => id === util.target.drawableID
                );
        }
    }

    findRunningTopBlocks({ threads, blocks }) {
        const runningBlocks = new Set();

        threads.forEach((thread) => {
            if (blocks[thread.topBlock]) {
                runningBlocks.add(thread.topBlock);
            }
        });

        return [...runningBlocks];
    }

    cloneWithThreads(args, util) {
        const newClone = util.target.makeClone();
        if (newClone) {
            this.runtime.addTarget(newClone);
            const runningBlocks = this.findRunningTopBlocks({
                threads: this.runtime.threads,
                blocks: util.target.blocks._blocks,
            });

            // filter newly created  thread for cloning
            const filteredRunningBlocks = runningBlocks.filter(
                (topBlock) => topBlock !== util.thread.topBlock
            );

            for (const block of filteredRunningBlocks) {
                this.runtime._pushThread(block, newClone);
            }
        }
    }

    touchingAnySprite(args, util) {
        const target = util.target;
        const otherSprites = this.runtime.targets.filter(
            (t) => t !== target && !t.isStage
        );
        return this.runtime.renderer.isTouchingDrawables(
            target.drawableID,
            otherSprites.map(({ drawableID }) => drawableID)
        );
    }

    whenGreenFlagOrClone() {
        return true;
    }

    whenGlitchRemoved() {
        return true;
    }

    whenBooleanHat(args) {
        return args.BOOLEAN;
    }

    broadcastLocal(args, util) {
        const broadcastVar = util.runtime
            .getTargetForStage()
            .lookupBroadcastMsg(null, args.MESSAGE);
        if (broadcastVar) {
            const BROADCAST_OPTION = broadcastVar.name;
            util.startHats(
                "event_whenbroadcastreceived",
                {
                    BROADCAST_OPTION,
                },
                util.target
            );
        }
    }

    isConnected() {
        return this.client.ready;
    }
}

module.exports = Scratch3BenderBlocks;
