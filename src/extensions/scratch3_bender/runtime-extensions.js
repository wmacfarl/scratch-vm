module.exports = function (runtime) {

    if (runtime.GAME_BENDER_EXTENSIONS) return;
    runtime.GAME_BENDER_EXTENSIONS = true;


    let limitThreads = false;
    const limitedTo = new Set();

    // Paused time support
    const pthread = runtime._pushThread;
    runtime.__pushThread = pthread;
    runtime._pushThread = (...args) => {
        if (limitThreads && !limitedTo.has(args[0])) {
            return {stack: []};
        }
        return pthread.apply(runtime, args);
    };

    runtime.limitThreadsToBlockIds = blockIds => {
        limitedTo.clear();
        if (!blockIds || blockIds.length === 0) {
            limitThreads = false;
        } else {
            limitThreads = true;
            blockIds.forEach(id => limitedTo.add(id));
        }
    };

    const stage = runtime.getTargetForStage();

    const {stepThreads} = runtime.sequencer;
    runtime.sequencer.stepThreads = (...args) => {
        runtime.startHats('bender_whenBooleanHat');
        return stepThreads.apply(runtime.sequencer, args);
    };

    const {getSpriteTargetByName} = runtime;
    runtime.getSpriteTargetByName = name =>
        getSpriteTargetByName.call(runtime, name) || runtime.targets.find(({id}) => id === name);

    // RenderedTarget Enhancements
    const RenderedTargetProto = Object.getPrototypeOf(stage);
    const {initDrawable, onGreenFlag} = RenderedTargetProto;

    RenderedTargetProto.onGreenFlag = function (...args) {
        this.runtime.startHats('bender_whenGreenFlagOrClone', null, this);
        return onGreenFlag.apply(this, args);
    };

    RenderedTargetProto.initDrawable = function (...args) {
        if (!this.isOriginal) {
            this.runtime.startHats('bender_whenGreenFlagOrClone', null, this);
        }
        return initDrawable.apply(this, args);
    };

    // get the first skin or create one (we use a pen skin because it has no arguments)
    const skin = runtime.renderer._allSkins.find(Boolean) || runtime.renderer.createPenSkin();
    let SkinProto = Object.getPrototypeOf(skin);
    // name is unreliable, Skin implements isTouchingNearest, so thats how we find it
    while (SkinProto && !Object.hasOwnProperty.call(SkinProto, 'isTouchingNearest')) {
        SkinProto = Object.getPrototypeOf(SkinProto);
    }

    const {renderer} = runtime;
    const {gl} = renderer;
    const fb = gl.createFramebuffer();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    SkinProto.toDataURL = function () {
        const scale = this._svgRenderer ? this._svgRenderer.getDrawRatio() * this._textureScale : 1;
        const [width, height] = this._textureSize || this.size.map(dim => Math.ceil(dim * scale));

        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.getTexture(), 0);
        const pixels = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        const imageData = ctx.createImageData(width, height);
        imageData.data.set(pixels);
        Object.assign(canvas, {width, height});
        ctx.putImageData(imageData, 0, 0);

        return canvas.toDataURL('image/png');
    };
};
