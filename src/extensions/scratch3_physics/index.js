// https://cdn.jsdelivr.net/gh/physics/physics.github.io/testExtension.js
const CATEGORY_WALLS = 0x0001;
const CATEGORY_NOT_WALLS = 0x0002;
const CATEGORY_STAGE_WALLS = 0x0004;
const CATEGORY_HIDDEN = 0x0008;

// Masks
const MASK_WALLS = CATEGORY_WALLS | CATEGORY_NOT_WALLS | CATEGORY_STAGE_WALLS; // WALLS collide with everything
const MASK_NOT_WALLS = CATEGORY_WALLS | CATEGORY_STAGE_WALLS; // NOT_WALLS should be affected by WALLS and STAGE_WALLS
const MASK_STAGE_WALLS = CATEGORY_WALLS | CATEGORY_NOT_WALLS; // STAGE_WALLS affect WALLS and NOT_WALLS

const MASK_SCREENWRAP = CATEGORY_WALLS; // Ignores STAGE_WALLS

const ArgumentType = require("../../extension-support/argument-type");
const BlockType = require("../../extension-support/block-type");
// const MathUtil = require('../../util/math-util');
// const Clone = require('../../util/clone');
const Cast = require("../../util/cast");
const Runtime = require("../../engine/runtime");
const RenderedTarget = require("../../sprites/rendered-target");
const formatMessage = require("format-message");
// const MathUtil = require('../../util/math-util');
// const Timer = require('../../util/timer');
// const Matter = require('matterJs/matter');
// const Matter = require('matter-js');

// const Box2D = require('./Box2d.min').box2d;
const Box2D = require("./box2d_es6");
const { is } = require("immutable");

// window.decomp = require('poly-decomp');

const b2World = Box2D.Dynamics.b2World;
const b2Vec2 = Box2D.Common.Math.b2Vec2;
const b2AABB = Box2D.Collision.b2AABB;
const b2BodyDef = Box2D.Dynamics.b2BodyDef;
const b2Body = Box2D.Dynamics.b2Body;
const b2FixtureDef = Box2D.Dynamics.b2FixtureDef;
// const b2Fixture = Box2D.Dynamics.b2Fixture;
// const b2Fixture = Box2D.Dynamics.b2Fixture;
const b2Contact = Box2D.Dynamics.Contacts.b2Contact;
// const b2MassData = Box2D.Collision.Shapes.b2MassData;
const b2PolygonShape = Box2D.Collision.Shapes.b2PolygonShape;
const b2CircleShape = Box2D.Collision.Shapes.b2CircleShape;
// const b2DebugDraw = Box2D.Dynamics.b2DebugDraw;
const b2MouseJointDef = Box2D.Dynamics.Joints.b2MouseJointDef;
const b2Math = Box2D.Common.Math.b2Math;

const fixDef = new b2FixtureDef();
const bodyDef = new b2BodyDef();

// const uid_seq = 0;
// let ujidSeq = 0;

const prevPos = {};
/**
 * Active b2Body/s in the world.
 * @type {Object.<string,*>}
 */
let world;
let zoom;
const bodies = {};
const pinned = {}; // Map of IDs to pinned joints
const stageBodies = [];
const _scroll = new b2Vec2(0, 0);
// const categorySeq = 1;
// const categories = {default: 1};

// const noCollideSeq = 0;

const toRad = Math.PI / 180;

// Used to record the scroll position of all sprites

const STAGE_TYPE_OPTIONS = {
    BOXED: "boxed",
    FLOOR: "floor",
    OPEN: "open",
};

const SPACE_TYPE_OPTIONS = {
    WORLD: "world",
    STAGE: "stage",
    RELATIVE: "relative",
};

const WHERE_TYPE_OPTIONS = {
    ANY: "any",
    FEET: "feet",
};

const SHAPE_TYPE_OPTIONS = {
    COSTUME: "costume",
    CIRCLE: "circle",
    SVG_POLYGON: "svg",
    ALL: "all",
};

const _definePolyFromHull = function (hullPoints) {
    fixDef.shape = new b2PolygonShape();

    const vertices = [];

    let prev = null;
    for (let i = hullPoints.length - 1; i >= 0; i--) {
        // for (let i = 0; i < hullPoints.length; i++) {
        const b2Vec = new b2Vec2(
            hullPoints[i].x / zoom,
            hullPoints[i].y / zoom
        );
        if (
            prev !== null &&
            b2Math.SubtractVV(b2Vec, prev).LengthSquared() > Number.MIN_VALUE
        ) {
            vertices.push(b2Vec);
        }
        prev = b2Vec;
    }

    fixDef.shape.SetAsArray(vertices);
};

const _placeBody = function (id, x, y, dir) {
    if (bodies[id]) {
        world.DestroyBody(bodies[id]);
    }

    bodyDef.position.x = (x + _scroll.x) / zoom;
    bodyDef.position.y = (y + _scroll.y) / zoom;
    bodyDef.angle = (90 - dir) * toRad;

    const body = world.CreateBody(bodyDef);
    body.uid = id;
    body.CreateFixture(fixDef);
    bodies[id] = body;
    return body;
};

const _applyForce = function (id, ftype, x, y, dir, pow) {
    const body = bodies[id];
    if (!body) {
        return;
    }

    dir = (90 - dir) * toRad;

    if (ftype === "Impulse") {
        const center = body.GetLocalCenter(); // get the mass data from you body

        body.ApplyImpulse(
            { x: pow * Math.cos(dir), y: pow * Math.sin(dir) },
            body.GetWorldPoint({
                x: x / zoom + center.x,
                y: y / zoom + center.y,
            })
        );
    } else if (ftype === "World Impulse") {
        body.ApplyForce(
            { x: pow * Math.cos(dir), y: pow * Math.sin(dir) },
            { x: x / zoom, y: y / zoom }
        );
    }
};

// ['', 'Define Spring Length: %n Damping: %n  Freq: %n', '_defineSpring', 100, 0.5, 8],
const defSpring = { len: 100, damp: 0.7, freq: 5 };
const _defineSpring = function (len, damp, freq) {
    defSpring.len = len < 0.1 ? 0.1 : len / zoom;
    defSpring.damp = damp < 0 ? 0.7 : damp;
    defSpring.freq = freq > 0 ? freq : 5;
};

const _createJointOfType = function (
    jName,
    typ,
    bodyID,
    x,
    y,
    bodyID2,
    x2,
    y2
) {
    // if (jName.length > 0) ext.destroyJoint(jName);

    if (!bodyID) bodyID = null;
    if (!bodyID2) bodyID2 = null;
    if (!bodyID && !bodyID2) {
        return null;
    }

    const body = bodyID ? bodies[bodyID] : world.GetGroundBody();
    const body2 = bodyID2 ? bodies[bodyID2] : world.GetGroundBody();

    if (!body || !body2) return null;

    let md;
    switch (typ) {
        case "Spring":
            md = new Box2D.Dynamics.Joints.b2DistanceJointDef();
            md.length = defSpring.len;
            md.dampingRatio = defSpring.damp;
            md.frequencyHz = defSpring.freq;
            md.bodyA = body;
            md.bodyB = body2;
            md.localAnchorA = { x: x / zoom, y: y / zoom };
            md.localAnchorB = { x: x2 / zoom, y: y2 / zoom };
            break;

        case "Rotating":
            md = new Box2D.Dynamics.Joints.b2RevoluteJointDef();
            md.bodyA = body;
            md.bodyB = body2;
            md.localAnchorA = { x: x / zoom, y: y / zoom };
            if (x2 === null) {
                if (body2) {
                    md.localAnchorB = body2.GetLocalPoint(body.GetPosition()); // Wheel Type Joint...
                } else {
                    md.localAnchorB = body.GetWorldPoint({
                        x: x / zoom,
                        y: y / zoom,
                    });
                }
            } else {
                md.localAnchorB = { x: x2 / zoom, y: y2 / zoom };
            }
            break;

        case "Mouse":
            md = new b2MouseJointDef();
            if (bodyID) {
                md.bodyB = body;
                md.target.Set(x / zoom, y / zoom);
            } else {
                md.bodyB = body2;
                md.target.Set(x2 / zoom, y2 / zoom);
            }
            md.bodyA = world.GetGroundBody();
            md.collideConnected = true;
            md.maxForce = 300.0 * body.GetMass();
            break;
    }

    // md.collideConnected = true;
    // md.maxForce = 300.0 * body.GetMass();
    const joint = world.CreateJoint(md);
    if (bodyID) {
        body.SetAwake(true);
    }
    if (bodyID2) {
        body2.SetAwake(true);
    }

    // if (!jName) {
    //     ujidSeq++;
    //     jName = `_${ujidSeq}`;
    // }
    // joints[jName] = joint;
    return joint;
};

/**
 * Set the X and Y coordinates (No Fencing)
 * @param {!RenderedTarget} rt the renderedTarget.
 * @param {!number} x New X coordinate, in Scratch coordinates.
 * @param {!number} y New Y coordinate, in Scratch coordinates.
 * @param {?boolean} force Force setting X/Y, in case of dragging
 */
const _setXY = function (rt, x, y, force) {
    if (rt.isStage) return;
    if (rt.dragging && !force) return;
    const oldX = rt.x;
    const oldY = rt.y;
    if (rt.renderer) {
        //   const position = rt.renderer.getFencedPositionOfDrawable(rt.drawableID, [x, y]);
        rt.x = x; // position[0];
        rt.y = y; // position[1];

        rt.renderer.updateDrawableProperties(rt.drawableID, {
            position: [x, y],
        });
        if (rt.visible) {
            rt.emit(RenderedTarget.EVENT_TARGET_VISUAL_CHANGE, rt);
            rt.runtime.requestRedraw();
        }
    } else {
        rt.x = x;
        rt.y = y;
    }

    rt.emit(RenderedTarget.EVENT_TARGET_MOVED, rt, oldX, oldY, force);
    rt.runtime.requestTargetsUpdate(rt);
};

const createStageBody = function () {
    const body = world.CreateBody(bodyDef);
    body.CreateFixture(fixDef);

    // Set the correct category bits for stage walls
    let categoryBits = CATEGORY_STAGE_WALLS;
    let maskBits = MASK_STAGE_WALLS; // This will only allow collision with types that should collide with stage walls

    // Loop through all fixtures of the body and update their filter data
    for (
        let fixture = body.GetFixtureList();
        fixture;
        fixture = fixture.GetNext()
    ) {
        let filter = fixture.GetFilterData();
        filter.categoryBits = categoryBits;
        filter.maskBits = maskBits;
        fixture.SetFilterData(filter);
    }
    stageBodies.push(body);
};

const _setStageType = function (type) {
    // Clear down previous stage
    if (stageBodies.length > 0) {
        for (const stageBodyID in stageBodies) {
            world.DestroyBody(stageBodies[stageBodyID]);
            delete stageBodies[stageBodyID];
        }
    }

    // Build up new stage
    bodyDef.type = b2Body.b2_staticBody;
    fixDef.shape = new b2PolygonShape();
    bodyDef.angle = 0;

    let left = (-240 + _scroll.x) / zoom;
    let right = (240 + _scroll.x) / zoom;
    let top = (180 + _scroll.y) / zoom;
    let bottom = (-180 + _scroll.y) / zoom;
    let boxWidth = 1000 / zoom;
    let boxHeight = 1000 / zoom;
    let screenWidth = 480 / zoom;
    let screenHeight = 360 / zoom;

    fixDef.shape.SetAsBox(boxWidth, screenHeight);
    bodyDef.position.Set(left - boxWidth, 0);
    createStageBody();
    bodyDef.position.Set(right + boxWidth, 0);
    createStageBody();
    fixDef.shape.SetAsBox(screenWidth, boxHeight);
    bodyDef.position.Set(0, top + boxHeight);
    createStageBody();
    bodyDef.position.Set(0, bottom - boxHeight);
    createStageBody();

    bodyDef.type = b2Body.b2_dynamicBody;

    for (const bodyID in bodies) {
        bodies[bodyID].SetAwake(true);
    }
};

/**
 * Icon svg to be displayed at the left edge of each extension block, encoded as a data URI.
 * @type {string}
 */
// eslint-disable-next-line max-len
const blockIconURI =
    "data:image/svg+xml;base64,PHN2ZyB2ZXJzaW9uPSIxLjEiDQoJIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiIHhtbG5zOmE9Imh0dHA6Ly9ucy5hZG9iZS5jb20vQWRvYmVTVkdWaWV3ZXJFeHRlbnNpb25zLzMuMC8iDQoJIHg9IjBweCIgeT0iMHB4IiB3aWR0aD0iNDBweCIgaGVpZ2h0PSI0MHB4IiB2aWV3Qm94PSItMy43IC0zLjcgNDAgNDAiIGVuYWJsZS1iYWNrZ3JvdW5kPSJuZXcgLTMuNyAtMy43IDQwIDQwIg0KCSB4bWw6c3BhY2U9InByZXNlcnZlIj4NCjxkZWZzPg0KPC9kZWZzPg0KPHJlY3QgeD0iOC45IiB5PSIxLjUiIGZpbGw9IiNGRkZGRkYiIHN0cm9rZT0iIzE2OUZCMCIgc3Ryb2tlLXdpZHRoPSIzIiB3aWR0aD0iMTQuOCIgaGVpZ2h0PSIxNC44Ii8+DQo8cmVjdCB4PSIxLjUiIHk9IjE2LjMiIGZpbGw9IiNGRkZGRkYiIHN0cm9rZT0iIzE2OUZCMCIgc3Ryb2tlLXdpZHRoPSIzIiB3aWR0aD0iMTQuOCIgaGVpZ2h0PSIxNC44Ii8+DQo8cmVjdCB4PSIxNi4zIiB5PSIxNi4zIiBmaWxsPSIjRkZGRkZGIiBzdHJva2U9IiMxNjlGQjAiIHN0cm9rZS13aWR0aD0iMyIgd2lkdGg9IjE0LjgiIGhlaWdodD0iMTQuOCIvPg0KPC9zdmc+";

/**
 * Icon svg to be displayed in the category menu, encoded as a data URI.
 * @type {string}
 */
// eslint-disable-next-line max-len
const menuIconURI =
    "data:image/svg+xml;base64,PHN2ZyB2ZXJzaW9uPSIxLjEiDQoJIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiIHhtbG5zOmE9Imh0dHA6Ly9ucy5hZG9iZS5jb20vQWRvYmVTVkdWaWV3ZXJFeHRlbnNpb25zLzMuMC8iDQoJIHg9IjBweCIgeT0iMHB4IiB3aWR0aD0iNDBweCIgaGVpZ2h0PSI0MHB4IiB2aWV3Qm94PSItMy43IC0zLjcgNDAgNDAiIGVuYWJsZS1iYWNrZ3JvdW5kPSJuZXcgLTMuNyAtMy43IDQwIDQwIg0KCSB4bWw6c3BhY2U9InByZXNlcnZlIj4NCjxkZWZzPg0KPC9kZWZzPg0KPHJlY3QgeD0iOC45IiB5PSIxLjUiIGZpbGw9IiNGRkZGRkYiIHN0cm9rZT0iIzE2OUZCMCIgc3Ryb2tlLXdpZHRoPSIzIiB3aWR0aD0iMTQuOCIgaGVpZ2h0PSIxNC44Ii8+DQo8cmVjdCB4PSIxLjUiIHk9IjE2LjMiIGZpbGw9IiNGRkZGRkYiIHN0cm9rZT0iIzE2OUZCMCIgc3Ryb2tlLXdpZHRoPSIzIiB3aWR0aD0iMTQuOCIgaGVpZ2h0PSIxNC44Ii8+DQo8cmVjdCB4PSIxNi4zIiB5PSIxNi4zIiBmaWxsPSIjRkZGRkZGIiBzdHJva2U9IiMxNjlGQjAiIHN0cm9rZS13aWR0aD0iMyIgd2lkdGg9IjE0LjgiIGhlaWdodD0iMTQuOCIvPg0KPC9zdmc+";

/**
 * Class for the music-related blocks in Scratch 3.0
 * @param {Runtime} runtime - the runtime instantiating this block package.
 * @constructor
 */
class Scratch3Physics {
    constructor(runtime) {
        /**
         * The runtime instantiating this block package.
         * @type {Runtime}
         */
        this.runtime = runtime;

        // Clear target motion state values when the project starts.
        this.runtime.on(Runtime.PROJECT_START, this.reset.bind(this));

        world = new b2World(
            new b2Vec2(0, 0), // gravity (10)
            true // allow sleep
        );
        const contactListener = new MyContactListener();
        world.SetContactListener(contactListener);
        this.runtime.stepPhysics = this.doTick.bind(this);
        this.runtime.setIsWall = this.setWall.bind(this);
        this.runtime.savePhysics = this.saveSnapshot.bind(this);
        this.runtime.loadPhysics = this.loadSnapshot.bind(this);
        this.runtime.setScreenwrap = this.setAllowScreenwrap.bind(this);
        this.runtime.setKicker = this.setKicker.bind(this);
        this.runtime.setStatic = this._setStatic.bind(this);

        this.runtime.physicsData = {
            world: world,
            bodies: bodies,
            pinned: pinned,
            stageBodies: stageBodies,
            _scroll: _scroll,
        };
        zoom = 50; // scale;

        this.map = {};

        fixDef.density = 1.0; // 1.0
        fixDef.friction = 0.5; // 0.5
        fixDef.restitution = 0.2; // 0.2

        _setStageType(STAGE_TYPE_OPTIONS.BOXED);
    }

    reset() {
        for (const body in bodies) {
            if (pinned[body.uid]) {
                world.DestroyJoint(pinned[body.uid]);
                delete pinned[body.uid];
            }
            world.DestroyBody(bodies[body]);
            delete bodies[body];
            delete prevPos[body];
        }
        //delete all stage bodies
        for (const stageBodyID in stageBodies) {
            world.DestroyBody(stageBodies[stageBodyID]);
            delete stageBodies[stageBodyID];
        }

        // todo: delete joins?
        _setStageType(STAGE_TYPE_OPTIONS.BOXED);
    }

    static get STATE_KEY() {
        return "Scratch.physics";
    }

    /**
     * @returns {object} metadata for this extension and its blocks.
     */
    getInfo() {
        return {
            id: "physics",
            name: formatMessage({
                id: "physics.categoryName",
                default: "Physics",
                description: "Label for the physics extension category",
            }),
            menuIconURI: menuIconURI,
            blockIconURI: blockIconURI,
            blocks: [
                // Global Setup ------------------

                {
                    opcode: "setStage",
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: "physics.setStage",
                        default: "setup stage [stageType]",
                        description: "Set the stage type",
                    }),
                    arguments: {
                        stageType: {
                            type: ArgumentType.STRING,
                            menu: "StageTypes",
                            defaultValue: STAGE_TYPE_OPTIONS.BOXED,
                        },
                    },
                },
                {
                    opcode: "setGravity",
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: "physics.setGravity",
                        default: "set gravity to x: [gx] y: [gy]",
                        description: "Set the gravity",
                    }),
                    arguments: {
                        gx: {
                            type: ArgumentType.NUMBER,
                            defaultValue: 0,
                        },
                        gy: {
                            type: ArgumentType.NUMBER,
                            defaultValue: -10,
                        },
                    },
                },

                "---",

                {
                    opcode: "setPhysics",
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: "physics.setPhysics",
                        default: "enable for [shape] mode [mode]",
                        description: "Enable Physics for this Sprite",
                    }),
                    arguments: {
                        shape: {
                            type: ArgumentType.STRING,
                            menu: "ShapeTypes",
                            defaultValue: "costume",
                        },
                        mode: {
                            type: ArgumentType.STRING,
                            menu: "EnableModeTypes",
                            defaultValue: "normal",
                        },
                    },
                },
                {
                    opcode: "setBounciness",
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: "physics.setBounciness",
                        default: "set bounciness to [BOUNCINESS]",
                        description: "Set the bounciness for this object",
                    }),
                    arguments: {
                        BOUNCINESS: {
                            type: ArgumentType.NUMBER,
                            defaultValue: 0.5, // Default bounciness
                        },
                    },
                },
                "---",

                {
                    opcode: "doTick",
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: "physics.doTick",
                        default: "step simulation",
                        description:
                            "Run a single tick of the physics simulation",
                    }),
                },

                "---",

                {
                    opcode: "setPosition",
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: "physics.setPosition",
                        default: "go to x: [x] y: [y] [space]",
                        description: "Position Sprite",
                    }),
                    arguments: {
                        x: {
                            type: ArgumentType.NUMBER,
                            defaultValue: 0,
                        },
                        y: {
                            type: ArgumentType.NUMBER,
                            defaultValue: 0,
                        },
                        space: {
                            type: ArgumentType.STRING,
                            menu: "SpaceTypes",
                            defaultValue: "world",
                        },
                    },
                },

                "---",

                // applyForce (target, ftype, x, y, dir, pow) {
                // applyAngForce (target, pow) {

                {
                    opcode: "setVelocity",
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: "physics.setVelocity",
                        default: "set velocity to sx: [sx] sy: [sy]",
                        description: "Set Velocity",
                    }),
                    arguments: {
                        sx: {
                            type: ArgumentType.NUMBER,
                            defaultValue: 0,
                        },
                        sy: {
                            type: ArgumentType.NUMBER,
                            defaultValue: 0,
                        },
                    },
                },
                {
                    opcode: "changeVelocity",
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: "physics.changeVelocity",
                        default: "change velocity by sx: [sx] sy: [sy]",
                        description: "Change Velocity",
                    }),
                    arguments: {
                        sx: {
                            type: ArgumentType.NUMBER,
                            defaultValue: 0,
                        },
                        sy: {
                            type: ArgumentType.NUMBER,
                            defaultValue: 0,
                        },
                    },
                },
                {
                    opcode: "getVelocityX",
                    text: formatMessage({
                        id: "physics.getVelocityX",
                        default: "x velocity",
                        description: "get the x velocity",
                    }),
                    blockType: BlockType.REPORTER,
                },
                {
                    opcode: "getVelocityY",
                    text: formatMessage({
                        id: "physics.getVelocityY",
                        default: "y velocity",
                        description: "get the y velocity",
                    }),
                    blockType: BlockType.REPORTER,
                },

                "---",

                {
                    opcode: "applyForce",
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: "physics.applyForce",
                        default: "push with force [force] in direction [dir]",
                        description: "Push this object in a given direction",
                    }),
                    arguments: {
                        force: {
                            type: ArgumentType.NUMBER,
                            defaultValue: 25,
                        },
                        dir: {
                            type: ArgumentType.NUMBER,
                            defaultValue: 0,
                        },
                    },
                },
                {
                    opcode: "applyAngForce",
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: "physics.applyAngForce",
                        default: "spin with force [force]",
                        description: "Push this object in a given direction",
                    }),
                    arguments: {
                        force: {
                            type: ArgumentType.NUMBER,
                            defaultValue: 500,
                        },
                    },
                },

                "---",

                {
                    opcode: "setStatic",
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: "physics.setStatic",
                        default: "set fixed [static]",
                        description:
                            "Sets whether this block is static or dynamic",
                    }),
                    arguments: {
                        static: {
                            type: ArgumentType.STRING,
                            menu: "StaticTypes",
                            defaultValue: "static",
                        },
                    },
                },
                // {
                //     opcode: 'setDensity',
                //     blockType: BlockType.COMMAND,
                //     text: formatMessage({
                //         id: 'physics.setDensity',
                //         default: 'set density [density]',
                //         description: 'Set the density of the object'
                //     }),
                //     arguments: {
                //         density: {
                //             type: ArgumentType.NUMBER,
                //             defaultValue: 1
                //         }
                //     }
                // },
                {
                    opcode: "setProperties",
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: "physics.setProperties",
                        default:
                            "set density [density] roughness [friction] bounce [restitution]",
                        description: "Set the density of the object",
                    }),
                    arguments: {
                        density: {
                            type: ArgumentType.NUMBER,
                            menu: "DensityTypes",
                            defaultValue: 100,
                        },
                        friction: {
                            type: ArgumentType.NUMBER,
                            menu: "FrictionTypes",
                            defaultValue: 50,
                        },
                        restitution: {
                            type: ArgumentType.NUMBER,
                            menu: "RestitutionTypes",
                            defaultValue: 20,
                        },
                    },
                },
                // {
                //     opcode: 'pinSprite',
                //     blockType: BlockType.COMMAND,
                //     text: formatMessage({
                //         id: 'physics.pinSprite',
                //         default: 'pin to world at sprite\'s x: [x] y: [y]',
                //         description: 'Pin the sprite'
                //     }),
                //     arguments: {
                //         x: {
                //             type: ArgumentType.NUMBER,
                //             defaultValue: 0
                //         },
                //         y: {
                //             type: ArgumentType.NUMBER,
                //             defaultValue: 0
                //         }
                //     }
                // },

                "---",

                {
                    opcode: "getTouching",
                    text: formatMessage({
                        id: "physics.getTouching",
                        default: "touching [where]",
                        description:
                            "get the name of any sprites we are touching",
                    }),
                    blockType: BlockType.REPORTER,
                    arguments: {
                        where: {
                            type: ArgumentType.STRING,
                            menu: "WhereTypes",
                            defaultValue: "any",
                        },
                    },
                },

                // Scene Scrolling -------------------

                "---",

                {
                    opcode: "setScroll",
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: "physics.setScroll",
                        default: "set scroll x: [ox] y: [oy]",
                        description:
                            "Sets whether this block is static or dynamic",
                    }),
                    arguments: {
                        ox: {
                            type: ArgumentType.NUMBER,
                            defaultValue: 0,
                        },
                        oy: {
                            type: ArgumentType.NUMBER,
                            defaultValue: 0,
                        },
                    },
                },
                {
                    opcode: "changeScroll",
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: "physics.changeScroll",
                        default: "change scroll by x: [ox] y: [oy]",
                        description:
                            "Sets whether this block is static or dynamic",
                    }),
                    arguments: {
                        ox: {
                            type: ArgumentType.NUMBER,
                            defaultValue: 0,
                        },
                        oy: {
                            type: ArgumentType.NUMBER,
                            defaultValue: 0,
                        },
                    },
                },
                {
                    opcode: "getScrollX",
                    text: formatMessage({
                        id: "physics.getScrollX",
                        default: "x scroll",
                        description: "get the x scroll",
                    }),
                    blockType: BlockType.REPORTER,
                },
                {
                    opcode: "getScrollY",
                    text: formatMessage({
                        id: "physics.getScrollY",
                        default: "y scroll",
                        description: "get the y scroll",
                    }),
                    blockType: BlockType.REPORTER,
                },

                // {
                //     opcode: 'getStatic',
                //     text: formatMessage({
                //         id: 'physics.getStatic',
                //         default: 'Static?',
                //         description: 'get whether this sprite is static'
                //     }),
                //     blockType: BlockType.BOOLEAN
                // }
            ],

            menus: {
                StageTypes: this.STAGE_TYPE_MENU,
                SpaceTypes: this.SPACE_TYPE_MENU,
                WhereTypes: this.WHERE_TYPE_MENU,
                ShapeTypes: this.SHAPE_TYPE_MENU,
                EnableModeTypes: this.ENABLE_TYPES_TYPE_MENU,
                StaticTypes: this.STATIC_TYPE_MENU,
                FrictionTypes: this.FRICTION_TYPE_MENU,
                RestitutionTypes: this.RESTITUTION_TYPE_MENU,
                DensityTypes: this.DENSITY_TYPE_MENU,
            },
        };
    }

    get STAGE_TYPE_MENU() {
        return [
            { text: "boxed stage", value: STAGE_TYPE_OPTIONS.BOXED },
            { text: "open (with floor)", value: STAGE_TYPE_OPTIONS.FLOOR },
            { text: "open (no floor)", value: STAGE_TYPE_OPTIONS.OPEN },
        ];
    }

    get SPACE_TYPE_MENU() {
        return [
            { text: "in world", value: SPACE_TYPE_OPTIONS.WORLD },
            { text: "on stage", value: SPACE_TYPE_OPTIONS.STAGE },
            { text: "relative", value: SPACE_TYPE_OPTIONS.RELATIVE },
        ];
    }

    get WHERE_TYPE_MENU() {
        return [
            { text: "any", value: WHERE_TYPE_OPTIONS.ANY },
            { text: "feet", value: WHERE_TYPE_OPTIONS.FEET },
        ];
    }

    get SHAPE_TYPE_MENU() {
        return [
            { text: "this costume", value: SHAPE_TYPE_OPTIONS.COSTUME },
            { text: "this circle", value: SHAPE_TYPE_OPTIONS.CIRCLE },
            { text: "this polygon", value: SHAPE_TYPE_OPTIONS.SVG_POLYGON },
            { text: "all sprites", value: SHAPE_TYPE_OPTIONS.ALL },
        ];
    }

    get ENABLE_TYPES_TYPE_MENU() {
        return [
            { text: "normal", value: "normal" },
            { text: "precision", value: "bullet" },
        ];
    }

    get STATIC_TYPE_MENU() {
        return [
            { text: "free", value: "dynamic" },
            { text: "fixed in place", value: "static" },
            { text: "fixed (but can rotate)", value: "pinned" },
        ];
    }

    get DENSITY_TYPE_MENU() {
        return [
            { text: "very light", value: "25" },
            { text: "light", value: "50" },
            { text: "normal", value: "100" },
            { text: "heavy", value: "200" },
            { text: "very heavy", value: "400" },
        ];
    }

    get FRICTION_TYPE_MENU() {
        return [
            { text: "none", value: "0" },
            { text: "smooth", value: "20" },
            { text: "normal", value: "50" },
            { text: "rough", value: "75" },
            { text: "extremely rough", value: "100" },
        ];
    }

    get RESTITUTION_TYPE_MENU() {
        return [
            { text: "none", value: "0" },
            { text: "little", value: "10" },
            { text: "normal", value: "20" },
            { text: "quite bouncy", value: "40" },
            { text: "very bouncy", value: "70" },
            { text: "unstable", value: "100" },
        ];
    }

    /**
     * Play a drum sound for some number of beats.
     * @property {number} x - x offset.
     * @property {number} y - y offset.
     */
    doTick() {
        // args, util) {
        this._checkMoved();

        // world.Step(1 / 30, 10, 10);
        world.Step(1 / 30, 20, 20);
        world.ClearForces();

        for (const targetID in bodies) {
            let body = bodies[targetID];
            const target = this.runtime.getTargetById(targetID);
            if (!target) {
                // Drop target from simulation
                world.DestroyBody(body);
                delete bodies[targetID];
                delete prevPos[targetID];
                continue;
            }

            if (
                (target.physicsCostumeName !== "hitbox" &&
                    target.physicsCostumeName !==
                        target.getCurrentCostume().name) ||
                target.size !== target.physicsSize
            ) {
                const cachedVelocity = body.GetLinearVelocity();
                body = this.setPhysicsFor(target);
                body.SetLinearVelocity(cachedVelocity);
            }
            target.physicsSize = target.size;
            if (!target.visible && !target.isHiddenPhysics) {
                this.setHidden(target, true);
            } else if (target.visible && target.isHiddenPhysics) {
                this.setHidden(target, false);
            }

            const position = body.GetPosition();

            _setXY(
                target,
                position.x * zoom - _scroll.x,
                position.y * zoom - _scroll.y
            );
            if (
                target.rotationStyle ===
                RenderedTarget.ROTATION_STYLE_ALL_AROUND
            ) {
                target.setDirection(90 - body.GetAngle() / toRad);
            }
            const pin = pinned[target.id];
            if (!pin) {
                // clear the angular velocity if not pinned
                body.SetAngularVelocity(0);
            }
            prevPos[targetID] = {
                x: target.x,
                y: target.y,
                dir: target.direction,
            };

            if (!body.allowScreenwrap) {
                const bounds = target.getBounds();
                if (bounds.right >= 240) {
                    const delta = bounds.right - 240;
                    target.x -= delta;
                    // reverse the x velocity
                    const vel = body.GetLinearVelocity();
                    body.SetLinearVelocity(new b2Vec2(-vel.x, vel.y));
                } else if (bounds.left <= -240) {
                    const delta = bounds.left + 240;
                    target.x -= delta;
                    const vel = body.GetLinearVelocity();
                    body.SetLinearVelocity(new b2Vec2(-vel.x, vel.y));
                }

                if (bounds.bottom <= -180) {
                    const delta = bounds.bottom + 180;
                    target.y -= delta;
                    const vel = body.GetLinearVelocity();
                    body.SetLinearVelocity(new b2Vec2(vel.x, -vel.y));
                }
                if (bounds.top >= 180) {
                    const delta = bounds.top - 180;
                    target.y -= delta;
                    const vel = body.GetLinearVelocity();
                    body.SetLinearVelocity(new b2Vec2(vel.x, -vel.y));
                }
            }
        }
    }

    _checkMoved() {
        for (const targetID in bodies) {
            const body = bodies[targetID];
            const target = this.runtime.getTargetById(targetID);
            if (!target) {
                // Drop target from simulation
                world.DestroyBody(body);
                delete bodies[targetID];
                delete prevPos[targetID];
                continue;
            }

            const prev = prevPos[targetID];
            const fixedRotation =
                target.rotationStyle !==
                RenderedTarget.ROTATION_STYLE_ALL_AROUND;

            if (prev && (prev.x !== target.x || prev.y !== target.y)) {
                const pos = new b2Vec2(
                    (target.x + _scroll.x) / zoom,
                    (target.y + _scroll.y) / zoom
                );
                this._setPosition(body, pos);
                if (!fixedRotation) {
                    body.SetAngle((90 - target.direction) * toRad);
                }
                body.SetAwake(true);
            } else if (
                !fixedRotation &&
                prev &&
                prev.dir !== target.direction
            ) {
                body.SetAngle((90 - target.direction) * toRad);
                body.SetAwake(true);
            }
        }
    }

    setPhysicsAll() {
        const allTargets = this.runtime.targets;
        if (allTargets === null) return;
        for (let i = 0; i < allTargets.length; i++) {
            const target = allTargets[i];
            if (!target.isStage && !bodies[target.id]) {
                this.setPhysicsFor(target);
            }
        }
    }

    /**
     * Play a drum sound for some number of beats.
     * @param {object} args - the block arguments.
     * @param {object} util - utility object provided by the runtime.
     * @property {string} shape - the shape
     */
    setPhysics(args, util) {
        // this._playDrumForBeats(args.DRUM, args.BEATS, util);
        // if (util.runtime.audioEngine === null) return;
        // if (util.target.sprite.soundBank === null) return;

        // const dx = Cast.toNumber(args.x);
        // const dy = Cast.toNumber(args.y);

        if (args.shape === SHAPE_TYPE_OPTIONS.ALL) {
            this.setPhysicsAll();
            return;
        }

        const target = util.target;
        const body = this.setPhysicsFor(target, args.shape);
        if (body) {
            body.SetBullet(args.mode === "bullet");
        }
    }

    setHidden(target, isHidden) {
        // Retrieve the Box2D body associated with the target
        let body = bodies[target.id];
        if (!body) {
            body = this.setPhysicsFor(target);
        }

        // Determine the new category and mask bits based on the isHidden flag
        let categoryBits = isHidden
            ? CATEGORY_HIDDEN
            : target.isPhysicsWall
            ? CATEGORY_WALLS
            : CATEGORY_NOT_WALLS;
        let maskBits = isHidden
            ? 0
            : target.isPhysicsWall
            ? CATEGORY_WALLS | CATEGORY_NOT_WALLS
            : CATEGORY_WALLS; // If not hidden, revert to previous collision rules

        // Loop through all fixtures of the body and update their filter data
        for (
            let fixture = body.GetFixtureList();
            fixture;
            fixture = fixture.GetNext()
        ) {
            let filter = fixture.GetFilterData();
            filter.categoryBits = categoryBits;
            filter.maskBits = maskBits;
            fixture.SetFilterData(filter);
        }

        // Update any metadata or properties you use to track the hidden state of the target
        target.isHiddenPhysics = isHidden;

        // Wake up the body so that it's active in the next step
        body.SetAwake(true);

        // Clear contacts by flagging them for filtering
        let contactEdge = body.GetContactList();
        while (contactEdge) {
            let contact = contactEdge.contact;
            // Mark the contact for a new filtering evaluation
            contact.FlagForFiltering();
            contactEdge = contactEdge.next;
        }
    }

    setAllowScreenwrap(target, allowScreenwrap) {
        if (target.isStage) {
            return; // Ignore if it's the stage itself
        }

        let body = bodies[target.id];
        if (!body) {
            body = this.setPhysicsFor(target); // Ensure the body exists
        }
        if (allowScreenwrap === body.allowScreenwrap) {
            return; // Ignore if the setting hasn't changed
        }
        body.allowScreenwrap = allowScreenwrap; // Track screenwrap setting
        // Retrieve current filter data and update mask bits based on screenwrap setting
        let maskBits = body.GetFixtureList().GetFilterData().maskBits;

        if (allowScreenwrap) {
            maskBits &= ~CATEGORY_STAGE_WALLS; // Remove stage walls from collision mask
        } else {
            maskBits |= CATEGORY_STAGE_WALLS; // Add stage walls to collision mask
        }

        // Update the collision filter of the body
        updateCollisionFilter(
            body,
            body.GetFixtureList().GetFilterData().categoryBits,
            maskBits
        );

        target.ignoresStageWalls = allowScreenwrap; // Track screenwrap setting
        body.allowScreenwrap = allowScreenwrap; // Track screenwrap setting
        body.SetAwake(true); // Make sure the body is active so changes take effect immediately

        // Flag all contacts for re-evaluation to update collision behavior
        let contactEdge = body.GetContactList();
        while (contactEdge) {
            let contact = contactEdge.contact;
            contact.FlagForFiltering();
            contactEdge = contactEdge.next;
        }
    }

    setWall(target, isWall) {
        if (target.isStage || target.isPhysicsWall === isWall) {
            return;
        }

        let body = bodies[target.id];
        if (!body) {
            body = this.setPhysicsFor(target);
        }
        if (isWall === body.isWall) {
            return;
        }
        body.isWall = isWall;

        let categoryBits, maskBits;
        if (isWall) {
            categoryBits = CATEGORY_WALLS;
            maskBits = MASK_WALLS; // WALLS should collide with NOT_WALLS and other WALLS
        } else {
            categoryBits = CATEGORY_NOT_WALLS;
            maskBits = MASK_NOT_WALLS; // NOT_WALLS should be stopped by WALLS
        }

        if (target.ignoresStageWalls) {
            maskBits &= ~CATEGORY_STAGE_WALLS;
        }

        // Use the helper function to update collision filters
        updateCollisionFilter(body, categoryBits, maskBits);

        target.isPhysicsWall = isWall;

        const variable = target.lookupOrCreateVariable(
            `$is_wall?_${target.sprite.clones[0].id}`,
            "is wall?"
        );
        variable.value = isWall;

        body.SetAwake(true);

        let contactEdge = body.GetContactList();
        while (contactEdge) {
            let contact = contactEdge.contact;
            contact.FlagForFiltering();
            contactEdge = contactEdge.next;
        }
    }

    setPhysicsFor(target, props) {
        if (!props) {
            props = {};
        }
        const {
            isWall = false,
            kickStrength = 0,
            isStatic = false,
            allowScreenwrap = false,
        } = props;
        const r = this.runtime.renderer;
        let startHidden = false;
        if (target.visible === false) {
            target.setVisible(true);
            startHidden = true;
        }
        const drawable = r._allDrawables[target.drawableID];

        // Check for a 'hitbox' costume

        const hitboxCostumeIndex = target.getCostumeIndexByName("hitbox"); // Method to get a costume by name
        let hitboxCostume = null;
        if (hitboxCostumeIndex !== -1) {
            hitboxCostume = target.getCostumes()[hitboxCostumeIndex];
        }
        const currentCostume = target.getCurrentCostume(); // Method to get the current costume
        const currentCostumeIndex = target.getCostumeIndexByName(
            currentCostume.name
        ); // Method to get a costume by name
        let costumeToUse = hitboxCostume || currentCostume; // Use 'hitbox' costume if available, otherwise current costume
        target.physicsCostumeName = costumeToUse.name;
        target.physicsCostumeSize = target.size;
        const costumeToUseIndex = target.getCostumeIndexByName(
            costumeToUse.name
        ); // Method to get a costume by name
        // Set the costume to the one we've determined to use
        target.setCostume(costumeToUseIndex);

        // Update convex hull points for the costume in use
        if (drawable.needsConvexHullPoints()) {
            const points = r._getConvexHullPointsForDrawable(target.drawableID);
            drawable.setConvexHullPoints(points);
        }

        const points = drawable._convexHullPoints;
        const scaleX = drawable.scale[0] / 100;
        const scaleY = drawable.scale[1] / -100; // Flip Y for hulls
        const offset = drawable.skin.rotationCenter;
        let allHulls = null;

        const hullPoints = [];
        for (const i in points) {
            hullPoints.push({
                x: (points[i][0] - offset[0]) * scaleX,
                y: (points[i][1] - offset[1]) * scaleY,
            });
        }

        _definePolyFromHull(hullPoints);

        const fixedRotation =
            target.rotationStyle !== RenderedTarget.ROTATION_STYLE_ALL_AROUND;
        const body = _placeBody(
            target.id,
            target.x,
            target.y,
            fixedRotation ? 90 : target.direction
        );
        //set to dynamic

        body.SetType(b2Body.b2_dynamicBody);
        body.isStatic = false;
        if (target.rotationStyle !== RenderedTarget.ROTATION_STYLE_ALL_AROUND) {
            body.SetFixedRotation(true);
        }

        if (allHulls) {
            for (let i = 1; i < allHulls.length; i++) {
                _definePolyFromHull(allHulls[i]);
                body.CreateFixture(fixDef);
            }
        }

        // Restore the original costume if we used the 'hitbox' costume
        if (hitboxCostume) {
            target.setCostume(currentCostumeIndex);
        }
        target.isPhysicsWall = "not yet set";
        this.setWall(target, isWall);
        this.setAllowScreenwrap(target, allowScreenwrap);
        if (isStatic) {
            body.SetType(b2Body.b2_staticBody);
            body.isStatic = true;
        }
        body.kickStrength = kickStrength;
        if (startHidden) {
            target.setVisible(false);

            this.setHidden(target, true);
        }
        //set friction to 0 for all fixtures
        for (
            let fixture = body.GetFixtureList();
            fixture;
            fixture = fixture.GetNext()
        ) {
            fixture.SetFriction(0);
        }

        return body;
    }

    /**
     *
     * @param svg the svg element
     * @param {Array} hullPointsList array of points
     * @private
     */
    _fetchPolygonPointsFromSVG(svg, hullPointsList, ox, oy, scaleX, scaleY) {
        if (svg.tagName === "g" || svg.tagName === "svg") {
            if (svg.hasChildNodes()) {
                for (const node of svg.childNodes) {
                    this._fetchPolygonPointsFromSVG(
                        node,
                        hullPointsList,
                        ox,
                        oy,
                        scaleX,
                        scaleY
                    );
                }
            }
            return;
        }

        if (svg.tagName !== "path") {
            return;
        }
        // This is it boys! Get that svg data :)
        // <path xmlns="http://www.w3.org/2000/svg" d="M 1 109.7118 L 1 1.8097 L 60.3049 38.0516 L 117.9625 1.8097 L 117.9625 109.7118 L 59.8931 73.8817 Z "
        //  data-paper-data="{&quot;origPos&quot;:null}" stroke-width="2" fill="#9966ff"/>

        let fx;
        let fy;

        const hullPoints = [];
        hullPointsList.push(hullPoints);

        const tokens = svg.getAttribute("d").split(" ");
        for (let i = 0; i < tokens.length; ) {
            const token = tokens[i++];
            if (token === "M" || token === "L") {
                const x = Cast.toNumber(tokens[i++]);
                const y = Cast.toNumber(tokens[i++]);
                hullPoints.push({ x: (x - ox) * scaleX, y: (y - oy) * scaleY });
                if (token === "M") {
                    fx = x;
                    fy = y;
                }
            }
            if (token === "Z") {
                hullPoints.push({
                    x: (fx - ox) * scaleX,
                    y: (fy - oy) * scaleY,
                });
            }
        }
    }

    setBounciness(args, util) {
        const bounciness = Cast.toNumber(args.BOUNCINESS);
        let body = bodies[util.target.id];
        if (!body) {
            body = this.setPhysicsFor(util.target);
        }
        const fixtures = body.GetFixtureList();
        for (
            let fixture = body.GetFixtureList();
            fixture;
            fixture = fixture.GetNext()
        ) {
            fixture.SetRestitution(bounciness);
        }
    }

    applyForce(args, util) {
        _applyForce(
            util.target.id,
            "Impulse",
            0,
            0,
            Cast.toNumber(args.dir),
            Cast.toNumber(args.force)
        );
    }

    applyAngForce(args, util) {
        let body = bodies[util.target.id];
        if (!body) {
            body = this.setPhysicsFor(util.target);
        }

        body.ApplyTorque(-Cast.toNumber(args.force));
    }

    setDensity(args, util) {
        let body = bodies[util.target.id];
        if (!body) {
            body = this.setPhysicsFor(util.target);
        }

        body.GetFixtureList().SetDensity(Cast.toNumber(args.density));
        body.ResetMassData();
    }

    setProperties(args, util) {
        let body = bodies[util.target.id];
        if (!body) {
            body = this.setPhysicsFor(util.target);
        }

        body.GetFixtureList().SetDensity(Cast.toNumber(args.density) / 100.0);
        body.GetFixtureList().SetFriction(Cast.toNumber(args.friction) / 100.0);
        body.GetFixtureList().SetRestitution(
            Cast.toNumber(args.restitution) / 100.0
        );
        body.ResetMassData();
    }

    pinSprite(args, util) {
        if (!bodies[util.target.id]) {
            this.setPhysicsFor(util.target);
        }

        const x = Cast.toNumber(args.x);
        const y = Cast.toNumber(args.y);

        _createJointOfType(
            null,
            "Rotating",
            util.target.id,
            x,
            y,
            null,
            null,
            null
        );
    }

    /**
     * Set's the sprites position.
     * @param {object} args - the block arguments.
     * @param {object} util - utility object provided by the runtime.
     * @property {number} x - x offset.
     * @property {number} y - y offset.
     * @property {string} space - Space type (SPACE_TYPE_OPTIONS)
     */
    setPosition(args, util) {
        const x = Cast.toNumber(args.x);
        const y = Cast.toNumber(args.y);
        const body = bodies[util.target.id];

        switch (args.space) {
            case SPACE_TYPE_OPTIONS.STAGE:
                _setXY(util.target, x, y); // Position on stage (after scroll)
                if (body) {
                    this._setPosition(
                        body,
                        new b2Vec2(
                            (x + _scroll.x) / zoom,
                            (y + _scroll.y) / zoom
                        )
                    );
                }
                break;
            case SPACE_TYPE_OPTIONS.RELATIVE: {
                _setXY(util.target, util.target.x + x, util.target.x + y);
                if (body) {
                    const pos = body.GetPosition();
                    const pos2 = new b2Vec2(pos.x + x / zoom, pos.y + y / zoom);
                    this._setPosition(body, pos2);
                }
                break;
            }
            default:
                _setXY(util.target, x - _scroll.x, y - _scroll.y);
                if (body) {
                    this._setPosition(body, new b2Vec2(x / zoom, y / zoom));
                }
        }
    }

    _setPosition(body, pos2) {
        const md = pinned[body.uid];
        if (md) {
            world.DestroyJoint(md);
            pinned[body.uid] = _createJointOfType(
                null,
                "Rotating",
                body.uid,
                0,
                0,
                null,
                pos2.x * zoom,
                pos2.y * zoom
            );
        }
        body.SetPosition(pos2);
        // if (md) {
        //     pinned[body.uid] = _createJointOfType(null, 'Rotating', body.uid, 0, 0, null, null, null);
        // }
    }

    /**
     * Set the sprites velocity.
     * @param {object} args - the block arguments.
     * @param {object} util - utility object provided by the runtime.
     * @property {number} sx - speed x.
     * @property {number} sy - speed y.
     */
    setVelocity(args, util) {
        this.runtime.requestRedraw();
        this.runtime.requestTargetsUpdate(util.target);
        let body = bodies[util.target.id];
        if (!body) {
            body = this.setPhysicsFor(util.target);
        }

        body.SetAwake(true);

        const x = Cast.toNumber(args.sx);
        const y = Cast.toNumber(args.sy);
        const force = new b2Vec2(x, y);
        force.Multiply(30 / zoom);
        body.SetLinearVelocity(force);
    }

    /**
     * Change the sprites velocity.
     * @param {object} args - the block arguments.
     * @param {object} util - utility object provided by the runtime.
     * @property {number} sx - speed x.
     * @property {number} sy - speed y.
     */
    changeVelocity(args, util) {
        this.runtime.requestRedraw();
        this.runtime.requestTargetsUpdate(util.target);
        let body = bodies[util.target.id];
        if (!body) {
            body = this.setPhysicsFor(util.target);
        }

        body.SetAwake(true);

        const x = Cast.toNumber(args.sx);
        const y = Cast.toNumber(args.sy);
        const force = new b2Vec2(x, y);
        force.Multiply(30 / zoom);
        force.Add(body.GetLinearVelocity());
        body.SetLinearVelocity(force);
    }

    /**
     * Get the current tempo.
     * @param {object} args - the block arguments.
     * @param {object} util - utility object provided by the runtime.
     * @return {boolean} - the current tempo, in beats per minute.
     */
    getStatic(args, util) {
        const body = bodies[util.target.id];
        if (!body) {
            return false;
        }
        const type = body.GetType();
        return type === b2Body.b2_staticBody;
    }

    /**
     * Get the current tempo.
     * @param {object} args - the block arguments.
     * @param {object} util - utility object provided by the runtime.
     * @return {number} - the current x velocity.
     */
    getVelocityX(args, util) {
        const body = bodies[util.target.id];
        if (!body) {
            return 0;
        }
        const x = body.GetLinearVelocity().x;
        return (x * zoom) / 30;
    }

    /**
     * Get the current tempo.
     * @param {object} args - the block arguments.
     * @param {object} util - utility object provided by the runtime.
     * @return {boolean} - the current y velocity.
     */
    getVelocityY(args, util) {
        const body = bodies[util.target.id];
        if (!body) {
            return 0;
        }
        const y = body.GetLinearVelocity().y;
        return (y * zoom) / 30;
    }

    /**
     * Sets the static property
     * @param {object} args - the block arguments.
     * @param {object} util - utility object provided by the runtime.
     * @property {string} static - static or not
     */
    setStatic(args, util) {
        const target = util.target;
        const isStatic = args.static === "static";
        let body = bodies[util.target.id];
        if (!body) {
            body = this.setPhysicsFor(target);
        }
        if (isStatic === body.isStatic) {
            return;
        }
        body.SetType(
            isStatic ? b2Body.b2_kinematicBody : b2Body.b2_dynamicBody
        );
        body.isStatic = isStatic;
        //set the velocity to 0
        if (isStatic) {
            body.SetLinearVelocity(new b2Vec2(0, 0));
            body.SetAngularVelocity(0);
        }

        const pos = new b2Vec2(
            (target.x + _scroll.x) / zoom,
            (target.y + _scroll.y) / zoom
        );
        const fixedRotation =
            target.rotationStyle !== RenderedTarget.ROTATION_STYLE_ALL_AROUND;
        body.SetPositionAndAngle(
            pos,
            fixedRotation ? 0 : (90 - target.direction) * toRad
        );

        if (args.static === "pinned") {
            // Find what's behind the sprite (pin to that)
            const point = new b2AABB();
            point.lowerBound.SetV(pos);
            point.upperBound.SetV(pos);
            let body2ID = null;
            world.QueryAABB((fixture) => {
                const body2 = fixture.GetBody();
                if (body2 !== body && fixture.TestPoint(pos.x, pos.y)) {
                    body2ID = body2.uid;
                    return false;
                }
                return true;
            }, point);

            pinned[target.id] = _createJointOfType(
                null,
                "Rotating",
                target.id,
                0,
                0,
                body2ID,
                null,
                null
            );
        } else {
            const pin = pinned[target.id];
            if (pin) {
                world.DestroyJoint(pin);
                // delete joints[pin.I];
                delete pinned[target.id];
            }
        }
    }

    /**
     * Sets the sprite offset
     * @param {object} args - the block arguments.
     * @property {number} ox - x offset.
     * @property {number} oy - y offset.
     */
    setScroll(args) {
        this._checkMoved();
        _scroll.x = Cast.toNumber(args.ox);
        _scroll.y = Cast.toNumber(args.oy);
        this._repositionBodies();
    }

    /**
     * Sets the sprite offset
     * @param {object} args - the block arguments.
     * @property {number} ox - x offset.
     * @property {number} oy - y offset.
     */
    changeScroll(args) {
        this._checkMoved();
        _scroll.x += Cast.toNumber(args.ox);
        _scroll.y += Cast.toNumber(args.oy);
        this._repositionBodies();
    }

    /**
     * Get the scroll x.
     * @return {number} - the current x velocity.
     */
    getScrollX() {
        return _scroll.x;
    }

    /**
     * Get the scroll x.
     * @return {number} - the current x velocity.
     */
    getScrollY() {
        return _scroll.y;
    }

    _repositionBodies() {
        for (const targetID in bodies) {
            const body = bodies[targetID];
            const target = this.runtime.getTargetById(targetID);
            if (target) {
                const position = body.GetPosition();
                _setXY(
                    target,
                    position.x * zoom - _scroll.x,
                    position.y * zoom - _scroll.y
                );
                prevPos[targetID] = {
                    x: target.x,
                    y: target.y,
                    dir: target.direction,
                };
            }
        }
    }

    getTouching(args, util) {
        const target = util.target;
        const body = bodies[target.id];
        if (!body) {
            return "";
        }
        const where = args.where;
        let touching = "";
        const contacts = body.GetContactList();
        for (let ce = contacts; ce; ce = ce.next) {
            // noinspection JSBitwiseOperatorUsage
            if (ce.contact.m_flags & b2Contact.e_islandFlag) {
                continue;
            }
            if (
                ce.contact.IsSensor() === true ||
                ce.contact.IsEnabled() === false ||
                ce.contact.IsTouching() === false
            ) {
                continue;
            }
            const contact = ce.contact;
            const fixtureA = contact.GetFixtureA();
            const fixtureB = contact.GetFixtureB();
            const bodyA = fixtureA.GetBody();
            const bodyB = fixtureB.GetBody();

            // const myFix = touchingB ? fixtureA : fixtureB;

            const touchingB = bodyA === body;
            if (where !== "any") {
                const man = new Box2D.Collision.b2WorldManifold();
                contact.GetWorldManifold(man);
                // man.m_points
                // const mx = man.m_normal.x;
                // const my = man.m_normal.y;

                if (where === "feet") {
                    // if (my > -0.6) {
                    //     continue;
                    // }

                    const fixture = body.GetFixtureList();
                    const y = man.m_points[0].y;
                    if (
                        y >
                        fixture.m_aabb.lowerBound.y * 0.75 +
                            fixture.m_aabb.upperBound.y * 0.25
                    ) {
                        continue;
                    }

                    // const lp = body.GetLocalPoint(man.m_points[0]).Normalize();
                    // if (lp.y)
                }
            }

            const other = touchingB ? bodyB : bodyA;
            const uid = other.uid;
            const target2 = uid
                ? this.runtime.getTargetById(uid)
                : this.runtime.getTargetForStage();
            if (target2) {
                const name = target2.sprite.name;
                if (touching.length === 0) {
                    touching = name;
                } else {
                    touching += `,${name}`;
                }
            }
        }
        return touching;
    }

    /**
     * Sets the stage
     * @param {object} args - the block arguments.
     * @property {number} stageType - Stage Type.
     */
    setStage(args) {
        _setStageType(args.stageType);
    }

    /**
     * Sets the gravity
     * @param {object} args - the block arguments.
     * @property {number} gx - Gravity x.
     * @property {number} gy - Gravity y.
     */
    setGravity(args) {
        world.SetGravity(
            new b2Vec2(Cast.toNumber(args.gx), Cast.toNumber(args.gy))
        );
        for (const bodyID in bodies) {
            bodies[bodyID].SetAwake(true);
        }
    }

    loadSnapshot(snapshot) {
        this.reset();
        if (!snapshot || !snapshot.bodies) {
            return;
        }
        const _bodies = snapshot.bodies;
        const _pinned = snapshot.pinned;
        const _stageBodies = snapshot.stageBodies;

        this.runtime.targets.forEach((target) => {
            const body = _bodies[target.id];
            if (body) {
                this.setPhysicsFor(target, {
                    isStatic: body.isStatic,
                    isWall: body.isWall,
                    allowScreenwrap: body.allowScreenwrap,
                    kickStrength: body.kickStrength,
                });
                const b = bodies[target.id];
                b.SetPosition(body.position);
                b.SetAngle(body.angle);
                b.SetLinearVelocity(body.linearVelocity);
                b.SetAngularVelocity(body.angularVelocity);
                b.SetFixedRotation(body.fixedRotation);
                b.SetType(body.type);
            }
        });

        Object.keys(_pinned).forEach((key) => {
            const joint = _pinned[key];
            _createJointOfType(
                null,
                joint.type,
                joint.bodyA,
                joint.anchorA.x,
                joint.anchorA.y,
                joint.bodyB,
                joint.anchorB.x,
                joint.anchorB.y
            );
        });

        _stageBodies.forEach((body) => {
            const b = _placeBody(
                null,
                body.position.x,
                body.position.y,
                body.angle
            );
            stageBodies.push(b);
        });
    }

    saveSnapshot() {
        const _bodies = serializeBodies(bodies);
        const _pinned = serializeJoints(pinned);
        const _stageBodies = serializeStageBodies(stageBodies);
        return {
            bodies: _bodies,
            pinned: _pinned,
            stageBodies: _stageBodies,
            scroll: _scroll,
        };
    }

    setKicker(target, strength) {
        const body = bodies[target.id];
        if (body) {
            body.kickStrength = strength;
        }
    }

    _setStatic(target, isStatic) {
        const staticString = isStatic ? "static" : "dynamic";
        this.setStatic({ static: staticString }, { target });
    }
}

function serializeBodies(bodies) {
    const _bodies = {};
    for (const key in bodies) {
        const body = bodies[key];
        _bodies[key] = {
            position: body.GetPosition(),
            angle: body.GetAngle(),
            linearVelocity: body.GetLinearVelocity(),
            angularVelocity: body.GetAngularVelocity(),
            fixedRotation: body.IsFixedRotation(),
            type: body.GetType(),
            isStatic: body.isStatic,
            isWall: body.isWall,
            allowScreenwrap: body.allowScreenwrap,
            kickStrength: body.kickStrength,
        };
    }
    return _bodies;
}

function serializeJoints(joints) {
    const _joints = {};
    for (const key in joints) {
        const joint = joints[key];
        _joints[key] = {
            type: joint.GetType(),
            bodyA: joint.GetBodyA().uid,
            bodyB: joint.GetBodyB().uid,
            anchorA: joint.GetAnchorA(),
            anchorB: joint.GetAnchorB(),
        };
    }
    return _joints;
}

function serializeStageBodies(stageBodies) {
    const _stageBodies = [];
    for (const key in stageBodies) {
        const body = stageBodies[key];
        _stageBodies.push({
            position: body.GetPosition(),
            angle: body.GetAngle(),
        });
    }
    return _stageBodies;
}

class MyContactListener extends Box2D.Dynamics.b2ContactListener {
    BeginContact(contact) {
        let bodyA = contact.GetFixtureA().GetBody();
        let bodyB = contact.GetFixtureB().GetBody();
        // Check if one of the bodies is kinematic and the other is a stage body
        if (
            (bodyA.GetType() == Box2D.Dynamics.b2Body.b2_kinematicBody &&
                bodyB.GetType() == Box2D.Dynamics.b2Body.b2_staticBody) ||
            (bodyB.GetType() == Box2D.Dynamics.b2Body.b2_kinematicBody &&
                bodyA.GetType() == Box2D.Dynamics.b2Body.b2_staticBody)
        ) {
            // Handle collision: e.g., stop the kinematic body
            const kinematicBody =
                bodyA.GetType() == Box2D.Dynamics.b2Body.b2_kinematicBody
                    ? bodyA
                    : bodyB;
            kinematicBody.SetLinearVelocity(new Box2D.Common.Math.b2Vec2(0, 0)); // Stop the body
        }
    }

    PostSolve(contact, impulse) {
        const fixtureA = contact.GetFixtureA();
        const fixtureB = contact.GetFixtureB();
        const bodyA = fixtureA.GetBody();
        const bodyB = fixtureB.GetBody();
        const worldManifold = new Box2D.Collision.b2WorldManifold();

        // This populates worldManifold with the correct contact points and normal
        contact.GetWorldManifold(worldManifold);

        // Get the normal vector from the contact
        const normal = worldManifold.m_normal; // This is a b2Vec2

        // Determine if one of the bodies is a kicker
        if (bodyA.kickStrength) {
            const kickDirection = new Box2D.Common.Math.b2Vec2(
                normal.x,
                normal.y
            );
            console.log("kickDirection A", kickDirection);
            this.applyKick(bodyB, bodyA.kickStrength, kickDirection);
        }
        if (bodyB.kickStrength) {
            // For bodyB, the kick direction should be opposite
            const kickDirection = new Box2D.Common.Math.b2Vec2(
                -normal.x,
                -normal.y
            );
            console.log("kickDirection B", kickDirection);
            this.applyKick(bodyA, bodyB.kickStrength, kickDirection);
        }
    }

    applyKick(body, kickStrength, kickDirection) {
        // Ensure the direction is a unit vector
        kickDirection.Normalize();

        // Scale the direction by the strength of the kick
        const kickVelocity = new Box2D.Common.Math.b2Vec2(
            kickDirection.x * kickStrength,
            kickDirection.y * kickStrength
        );

        // Add this velocity to the current body's velocity
        const currentVelocity = body.GetLinearVelocity();
        const newVelocity = new Box2D.Common.Math.b2Vec2(
            currentVelocity.x + kickVelocity.x,
            currentVelocity.y + kickVelocity.y
        );

        // Apply the new velocity to the body
        body.SetLinearVelocity(newVelocity);
    }
}

function updateCollisionFilter(body, categoryBits, maskBits) {
    for (
        let fixture = body.GetFixtureList();
        fixture;
        fixture = fixture.GetNext()
    ) {
        let filter = fixture.GetFilterData();
        filter.categoryBits = categoryBits;
        filter.maskBits = maskBits;
        fixture.SetFilterData(filter);
    }
}

module.exports = Scratch3Physics;
