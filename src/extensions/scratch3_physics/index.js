// https://cdn.jsdelivr.net/gh/physics/physics.github.io/testExtension.js
const CATEGORY_WALLS = 0x0001;
const CATEGORY_NOT_WALLS = 0x0002;
const CATEGORY_HIDDEN = 0x0008;
const zoom = 50;
const LINEAR_DAMPING = 1;
const ANGULAR_DAMPING = 0;
const MAX_VELOCITY = 200;
const MIN_VELOCITY = 0.1;
// Masks
const MASK_WALLS = CATEGORY_WALLS | CATEGORY_NOT_WALLS; // WALLS collide with everything
const MASK_NOT_WALLS = CATEGORY_WALLS; // NOT_WALLS should be affected by WALLS

const ArgumentType = require("../../extension-support/argument-type");
const BlockType = require("../../extension-support/block-type");

const Cast = require("../../util/cast");
const Runtime = require("../../engine/runtime");
const RenderedTarget = require("../../sprites/rendered-target");
const formatMessage = require("format-message");

const Box2D = require("./box2d_es6");

const b2World = Box2D.Dynamics.b2World;
const b2Vec2 = Box2D.Common.Math.b2Vec2;
const b2AABB = Box2D.Collision.b2AABB;
const b2BodyDef = Box2D.Dynamics.b2BodyDef;
const b2Body = Box2D.Dynamics.b2Body;
const b2FixtureDef = Box2D.Dynamics.b2FixtureDef;

const b2Contact = Box2D.Dynamics.Contacts.b2Contact;

const b2PolygonShape = Box2D.Collision.Shapes.b2PolygonShape;
const b2Math = Box2D.Common.Math.b2Math;

const fixDef = new b2FixtureDef();
const bodyDef = new b2BodyDef();

const prevPos = {};
let world;

const bodies = {};
const stageBodies = [];
const toRad = Math.PI / 180;

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
    if (hullPoints.length < 3) {
        hullPoints = [
            { x: 0, y: 0 },
            { x: 0, y: 10 },
            { x: 10, y: 0 },
        ];
    }
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

    bodyDef.position.x = x / zoom;
    bodyDef.position.y = y / zoom;
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
    let categoryBits = CATEGORY_WALLS;
    let maskBits = MASK_WALLS; // This will only allow collision with types that should collide with stage walls

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

const setupStage = function () {
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

    let left = -240 / zoom;
    let right = 240 / zoom;
    let top = 180 / zoom;
    let bottom = -180 / zoom;
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
            new b2Vec2(0, 0), // gravity (0)
            true // allow sleep
        );
        const contactListener = new MyContactListener();
        world.SetContactListener(contactListener);

        this.runtime.stepPhysics = this.doTick.bind(this);
        this.runtime.savePhysics = this.saveSnapshot.bind(this);
        this.runtime.loadPhysics = this.loadSnapshot.bind(this);
        this.runtime.setScreenwrap = this.setAllowScreenwrap.bind(this);
        this.runtime.setKicker = this.setKicker.bind(this);

        this.runtime.physicsData = {
            world: world,
            bodies: bodies,
            stageBodies: stageBodies,
        };

        this.map = {};

        fixDef.density = 1.0; // 1.0
        fixDef.friction = 0.5; // 0.5
        fixDef.restitution = 0.2; // 0.2

        setupStage();
    }

    reset() {
        for (const body in bodies) {
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
        setupStage();
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
                    opcode: "setKickStrength",
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: "physics.setKickStrength",
                        default: "set kick strength to [strength]",
                        description: "Set the strength of the kick",
                    }),
                    arguments: {
                        strength: {
                            type: ArgumentType.NUMBER,
                            defaultValue: 10,
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
                    opcode: "getKickStrength",
                    text: formatMessage({
                        id: "physics.getKickStrength",
                        default: "kick strength",
                        description: "get the kick strength",
                    }),
                    blockType: BlockType.REPORTER,
                },
                {
                    opcode: "getBounciness",
                    text: formatMessage({
                        id: "physics.getBounciness",
                        default: "bounciness",
                        description: "get the bounciness",
                    }),
                    blockType: BlockType.REPORTER,
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
                {
                    opcode: "setIsWall",
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: "physics.setIsWall",
                        default: "set is wall [isWall]",
                        description: "Sets whether this block is a wall",
                    }),
                    arguments: {
                        isWall: {
                            type: ArgumentType.STRING,
                            menu: "WallTypes",
                            defaultValue: "wall",
                        },
                    },
                },
                {
                    opcode: "setLinearDamping",
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: "physics.setLinearDamping",
                        default: "set friction to [damping]",
                        description: "Set the linear damping of the object",
                    }),
                    arguments: {
                        damping: {
                            type: ArgumentType.NUMBER,
                            defaultValue: 1,
                        },
                    },
                },
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
                {
                    opcode: "getStatic",
                    text: formatMessage({
                        id: "physics.getStatic",
                        default: "is static?",
                        description: "get whether this sprite is static",
                    }),
                    blockType: BlockType.REPORTER,
                },
                {
                    opcode: "getIsWall",
                    text: formatMessage({
                        id: "physics.getIsWall",
                        default: "is wall?",
                        description: "get whether this sprite is static",
                    }),
                    blockType: BlockType.REPORTER,
                },
            ],

            menus: {
                SpaceTypes: this.SPACE_TYPE_MENU,
                WhereTypes: this.WHERE_TYPE_MENU,
                ShapeTypes: this.SHAPE_TYPE_MENU,
                EnableModeTypes: this.ENABLE_TYPES_TYPE_MENU,
                StaticTypes: this.STATIC_TYPE_MENU,
                WallTypes: this.WALL_TYPE_MENU,
                FrictionTypes: this.FRICTION_TYPE_MENU,
                RestitutionTypes: this.RESTITUTION_TYPE_MENU,
                DensityTypes: this.DENSITY_TYPE_MENU,
            },
        };
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
            { text: "free", value: "free" },
            { text: "static", value: "static" },
        ];
    }

    get WALL_TYPE_MENU() {
        return [
            { text: "wall", value: "wall" },
            { text: "not wall", value: "not wall"},
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
        this._checkMoved();

        world.Step(1 / 30, 20, 20);
        world.ClearForces();

        for (const targetID in bodies) {
            let body = bodies[targetID];
            previousPosition = prevPos[targetID]
                ? prevPos[targetID]
                : { x: 0, y: 0 };

            const target = this.runtime.getTargetById(targetID);
            if (!target) {
                world.DestroyBody(body);
                delete bodies[targetID];
                delete prevPos[targetID];
                continue;
            }

            

            const position = body.GetPosition();
         //   if (!body.isStatic) {
                _setXY(target, position.x * zoom, position.y * zoom);
         //   }

            //TODO:  Does this make sense?  Who gets to decide the rotation?  Physics or Scratch?  When?
            if (
                target.rotationStyle ===
                RenderedTarget.ROTATION_STYLE_ALL_AROUND
            ) {
                target.setDirection(90 - body.GetAngle() / toRad);
            }

            prevPos[targetID] = {
                x: target.x,
                y: target.y,
                dir: target.direction,
            };

            if (!body.allowScreenwrap && body.isStatic) {
                const bounds = target.getBounds();
                if (bounds.right >= 245) {
                    const delta = bounds.right - 245;
                    target.x -= delta;
                    // reverse the x velocity
                    const vel = body.GetLinearVelocity();
                    body.SetLinearVelocity(new b2Vec2(-vel.x, vel.y));
                } else if (bounds.left <= -245) {
                    const delta = bounds.left + 245;
                    target.x -= delta;
                    const vel = body.GetLinearVelocity();
                    body.SetLinearVelocity(new b2Vec2(-vel.x, vel.y));
                }

                if (bounds.bottom <= -185) {
                    const delta = bounds.bottom + 185;
                    target.y -= delta;
                    const vel = body.GetLinearVelocity();
                    body.SetLinearVelocity(new b2Vec2(vel.x, -vel.y));
                }
                if (bounds.top >= 185) {
                    const delta = bounds.top - 185;
                    target.y -= delta;
                    const vel = body.GetLinearVelocity();
                    body.SetLinearVelocity(new b2Vec2(vel.x, -vel.y));
                }
            }
        }
    }

    _checkMoved() {
        for (const targetID in bodies) {
            let body = bodies[targetID];
            let target = this.runtime.getTargetById(targetID);


            if (!target) {
                // Drop target from simulation
                world.DestroyBody(body);
                delete bodies[targetID];
                delete prevPos[targetID];
                continue;
            }



            const prev = prevPos[targetID];
            const fixedRotation = true;
if (
                (target.physicsCostumeName !== "hitbox" &&
                    target.physicsCostumeName !==
                        target.getCurrentCostume().name) ||
                target.size !== target.physicsSize ||
                body.isStatic
            ) {
                const cachedVelocity = body.GetLinearVelocity();
                body = this.setPhysicsFor(target);
                body.SetLinearVelocity(cachedVelocity);
            }

            target.physicsSize = target.size;
            if (!target.visible && !body.isHidden){
                this.setHidden(target, true);
            } else if (target.visible && body.isHidden) {
                this.setHidden(target, false);
            }
            if (prev && (prev.x !== target.x || prev.y !== target.y)) {
                const pos = new b2Vec2(target.x / zoom, target.y / zoom);
                body.SetAwake(true);
                body.SetPosition(pos);
            }
            if (prev && prev.dir !== target.direction) {
                body.SetAngle((90 - target.direction) * toRad);
                body.SetAwake(true);
            }

            const velocityMagnitude = body.GetLinearVelocity().Length();
            if (velocityMagnitude > MAX_VELOCITY) {
                const velocity = body.GetLinearVelocity();
                velocity.Normalize();
                velocity.Multiply(MAX_VELOCITY);
                body.SetLinearVelocity(velocity);
            }
            if (velocityMagnitude < MIN_VELOCITY) {
                body.SetLinearVelocity(new b2Vec2(0, 0));
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
        if (args.shape === SHAPE_TYPE_OPTIONS.ALL) {
            this.setPhysicsAll();
            return;
        }

        const target = util.target;
        const body = this.setPhysicsFor(target);
    }

    setHidden(target, isHidden) {
        let body = bodies[target.id];
        if (!body) {
            body = this.setPhysicsFor(target);
        }
        if (isHidden){
            this.setCollisionFilter(target, "not wall")
        } else {
            this.setCollisionFilter(target, body.isWall ? "wall" : "not wall")
        }
        body.isHidden = isHidden;

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

    setCollisionFilter(target, type) {
        let body = bodies[target.id];
        if (!body) {
            body = this.setPhysicsFor(target); // Ensure the body exists
        }
        let categoryBits, maskBits;
        if (type === "wall") {
            categoryBits = CATEGORY_WALLS;
            maskBits = MASK_WALLS; // WALLS should collide with NOT_WALLS and other WALLS
        } else {
            categoryBits = CATEGORY_NOT_WALLS;
            maskBits = MASK_NOT_WALLS; // NOT_WALLS should be stopped by WALLS
        }
        updateCollisionFilter(body, categoryBits, maskBits);
    }

    setPhysicsFor(target, props) {
        let isWall = false,
            kickStrength = 0,
            isStatic = false,
            allowScreenwrap = false;
            isHidden = false;
        if (props) {
            if (props.isWall === "wall" || props.isWall === true) {
                props.isWall = true;
            } else {
                props.isWall = false;
            }
            isWall = props.isWall;
            kickStrength = props.kickStrength;
            isStatic = props.isStatic;
            allowScreenwrap = props.allowScreenwrap;
            isHidden = props.isHidden;
        } else {
            let oldBody = bodies[target.id];
            if (!oldBody) {
                if (!target.isOriginal){
                    const originalId = target.sprite.clones[0].id
                    oldBody = bodies[originalId];
            
                }
            }
            if (oldBody) {
                isWall = oldBody.isWall;
                isStatic = oldBody.isStatic;
                allowScreenwrap = oldBody.allowScreenwrap;
                kickStrength = oldBody.kickStrength;
                isHidden = oldBody.isHidden;
            }
        }
        const r = this.runtime.renderer;

        if (target.visible === false) {
            target.setVisible(true);
            isHidden = true;
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

        const body = _placeBody(
            target.id,
            target.x,
            target.y,
            target.direction
        );
        //set to dynamic
        if (isStatic) {
            body.SetType(b2Body.b2_staticBody);
            body.isStatic = true;
        } else {
            body.SetType(b2Body.b2_dynamicBody);
            body.isStatic = false;
        }        
        this.setCollisionFilter(target, isWall ? "wall" : "not wall");
        body.SetLinearDamping(LINEAR_DAMPING);
        body.SetAngularDamping(ANGULAR_DAMPING);
        body.SetPosition(new b2Vec2(target.x / zoom, target.y / zoom));
        body.SetFixedRotation(true);
        body.isWall = isWall;

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

    //    this.setAllowScreenwrap(target, allowScreenwrap);


        body.kickStrength = kickStrength;
        if (isHidden) {
            target.setVisible(false);
        }
        this.setHidden(target, isHidden);

        //set friction to 0 for all fixtures
        for (
            let fixture = body.GetFixtureList();
            fixture;
            fixture = fixture.GetNext()
        ) {
            fixture.SetFriction(0);
        }
        body.targetId = target.id;
        return body;
    }

    setKickStrength(args, util) {
        const target = util.target;
        let body = bodies[target.id];
        if (!body) {
            body = this.setPhysicsFor(target);
        }
        body.kickStrength = args.strength;
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

    getStatic(args, util) {
        const body = bodies[util.target.id];
        if (!body) {
            return false;
        }

        return body.isStatic;
    }

    getIsWall(args, util) {
        const body = bodies[util.target.id];
        if (!body) {
            return false;
        }

        return body.isWall;
    }

    getBounciness(args, util) {
        const body = bodies[util.target.id];
        if (!body) {
            return 0;
        }
        const fixture = body.GetFixtureList();
        return fixture.GetRestitution();
    }

    getKickStrength(args, util) {
        const body = bodies[util.target.id];
        if (!body) {
            return 0;
        }
        return body.kickStrength;
    }

    getVelocityX(args, util) {
        const body = bodies[util.target.id];
        if (!body) {
            return 0;
        }
        const x = body.GetLinearVelocity().x;
        return (x * zoom) / 30;
    }

    getVelocityY(args, util) {
        const body = bodies[util.target.id];
        if (!body) {
            return 0;
        }
        const y = body.GetLinearVelocity().y;
        return (y * zoom) / 30;
    }

    setIsWall(args, util) {
        const body = bodies[util.target.id];
        if (!body) {
            bo
            return;
        }
        let isWall = false;
        
        if (args.isWall === "wall" || args.isWall === true){
            isWall = true
        } else {
            isWall= false
        }
      

        body.isWall = isWall;
        const isWallString = isWall ? "wall" : "not wall";
        this.setCollisionFilter(util.target, isWallString);
    }

    setLinearDamping(args, util) {
        const body = bodies[util.target.id];
        if (!body) {
            return;
        }
        body.SetLinearDamping(args.damping);
    }

    setStatic(args, util) {
        const target = util.target;
        let body = bodies[util.target.id];
        if (!body) {
            body = this.setPhysicsFor(target);
        }
        const argsStatic = args.static === "static" ? true : false;
        if (body.isStatic === argsStatic) {
            return;
        }
        body.SetLinearVelocity(new b2Vec2(0, 0));
        body.SetAngularVelocity(0);
        switch (args.static) {
            case "free":
                body.SetType(b2Body.b2_dynamicBody);
                break;
            case "static":
                body.SetType(b2Body.b2_staticBody);
                break;
        }
        body.isStatic = args.static === "static";
        const pos = new b2Vec2(target.x / zoom, target.y / zoom);
        body.SetPositionAndAngle(pos, (90 - target.direction) * toRad);
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

                if (where === "feet") {
                    const fixture = body.GetFixtureList();
                    const y = man.m_points[0].y;
                    if (
                        y >
                        fixture.m_aabb.lowerBound.y * 0.75 +
                            fixture.m_aabb.upperBound.y * 0.25
                    ) {
                        continue;
                    }
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

    loadSnapshot(snapshot) {
        this.reset();
        if (!snapshot || !snapshot.bodies) {
            return;
        }
        const _bodies = snapshot.bodies;

        const _stageBodies = snapshot.stageBodies;

        this.runtime.targets.forEach((target) => {
            const body = _bodies[target.id];
            if (body) {
                
                this.setPhysicsFor(target, {
                    isStatic: body.isStatic,
                    isWall: body.isWall,
                    allowScreenwrap: body.allowScreenwrap,
                    kickStrength: body.kickStrength,
                    isHidden: body.isHidden,
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
        const _stageBodies = serializeStageBodies(stageBodies);
        return {
            bodies: _bodies,
            stageBodies: _stageBodies,
        };
    }

    setKicker(target, strength) {
        const body = bodies[target.id];
        if (body) {
            body.kickStrength = strength;
        }
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
            isHidden: body.isHidden,
            isStatic: body.isStatic,
            isWall: body.isWall,
            allowScreenwrap: body.allowScreenwrap,
            kickStrength: body.kickStrength,
        };
    }
    return _bodies;
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
        if (bodyA.kickStrength > 0) {
            const kickDirection = new Box2D.Common.Math.b2Vec2(
                normal.x,
                normal.y
            );
            this.applyKick(bodyB, bodyA.kickStrength, kickDirection);
        }
        if (bodyB.kickStrength > 0) {
            // For bodyB, the kick direction should be opposite
            const kickDirection = new Box2D.Common.Math.b2Vec2(
                -normal.x,
                -normal.y
            );
            this.applyKick(bodyA, bodyB.kickStrength, kickDirection);
        }

        const velocityA = bodyA.GetLinearVelocity();
        const velocityB = bodyB.GetLinearVelocity();
        const massA = bodyA.GetMass();
        const massB = bodyB.GetMass();
        const positionA = bodyA.GetPosition();
        const positionB = bodyB.GetPosition();
        const massRatio = 1;
        if (velocityA.x === 0 && velocityA.y === 0) {
            let previousPosition = scratchPositionToBox2DPosition(
                prevPos[bodyA.targetId]
            );
            if (previousPosition) {
                const delta = {
                    x: positionA.x - previousPosition.x,
                    y: positionA.y - previousPosition.y,
                };
                const deltaMagnitude = Math.sqrt(
                    delta.x * delta.x + delta.y * delta.y
                );
                if (deltaMagnitude > 0.2) {
                    delta.x = (delta.x / deltaMagnitude) * 0.2;
                    delta.y = (delta.y / deltaMagnitude) * 0.2;
                }

                const newVelocity = {
                    x: delta.x * massRatio + velocityB.x,
                    y: delta.y * massRatio + velocityB.y,
                };
                bodyB.SetLinearVelocity(
                    new Box2D.Common.Math.b2Vec2(newVelocity.x, newVelocity.y)
                );
            }
        }
        if (velocityB.x === 0 && velocityB.y === 0) {
            const previousPosition = scratchPositionToBox2DPosition(
                prevPos[bodyB.targetId]
            );
            if (previousPosition) {
                const delta = {
                    x: positionB.x - previousPosition.x,
                    y: positionB.y - previousPosition.y,
                };
                const deltaMagnitude = Math.sqrt(
                    delta.x * delta.x + delta.y * delta.y
                );
                if (deltaMagnitude > 0.2) {
                    delta.x = (delta.x / deltaMagnitude) * 0.2;
                    delta.y = (delta.y / deltaMagnitude) * 0.2;
                }

                const newVelocity = {
                    x: delta.x * massRatio + velocityA.x,
                    y: delta.y * massRatio + velocityA.y,
                };
                bodyA.SetLinearVelocity(
                    new Box2D.Common.Math.b2Vec2(newVelocity.x, newVelocity.y)
                );
            }
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

    let contactEdge = body.GetContactList();
    while (contactEdge) {
        let contact = contactEdge.contact;
        contact.FlagForFiltering();
        contactEdge = contactEdge.next;
    }
}

function scratchPositionToBox2DPosition(position) {
    if (!position) {
        return null;
    }
    const { x, y } = position;
    return new b2Vec2(x / zoom, y / zoom);
}

module.exports = Scratch3Physics;
