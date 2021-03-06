import AnimatedWithChildren from './AnimatedWithChildren'
import InteractionManager from './injectable/InteractionManager'
import AnimatedInterpolation from './AnimatedInterpolation'
import Interpolation from './Interpolation'
import Animation from './Animation'
import guid from './guid'

/**
 * Animated works by building a directed acyclic graph of dependencies
 * transparently when you render your Animated components.
 *
 *               new Animated.Value(0)
 *     .interpolate()        .interpolate()    new Animated.Value(1)
 *         opacity               translateY      scale
 *          style                         transform
 *         View#234                         style
 *                                         View#123
 *
 * A) Top Down phase
 * When an Animated.Value is updated, we recursively go down through this
 * graph in order to find leaf nodes: the views that we flag as needing
 * an update.
 *
 * B) Bottom Up phase
 * When a view is flagged as needing an update, we recursively go back up
 * in order to build the new value that it needs. The reason why we need
 * this two-phases process is to deal with composite props such as
 * transform which can receive values from multiple parents.
 */

function findAnimatedStyles(node, styles) {
    if (typeof node.update === 'function') styles.add(node)
    else node.__getChildren().forEach(child => findAnimatedStyles(child, styles))
}

function _flush(rootNode) {
    var animatedStyles = new Set()
    findAnimatedStyles(rootNode, animatedStyles)
    animatedStyles.forEach(animatedStyle => animatedStyle.update())
}

/**
 * Standard value for driving animations.  One `Animated.Value` can drive
 * multiple properties in a synchronized fashion, but can only be driven by one
 * mechanism at a time.  Using a new mechanism (e.g. starting a new animation,
 * or calling `setValue`) will stop any previous ones.
 */
class AnimatedValue extends AnimatedWithChildren {
    constructor(value) {
        super()
        this._value = value
        this._offset = 0
        this._animation = null
        this._listeners = {}
    }

    __detach() {
        this.stopAnimation()
    }

    __getValue() {
        return this._value + this._offset
    }

    /**
     * Directly set the value.  This will stop any animations running on the value
     * and update all the bound properties.
     */
    setValue(value) {
        if (this._animation) {
            this._animation.stop()
            this._animation = null
        }
        this._updateValue(value)
    }

    /**
     * Sets an offset that is applied on top of whatever value is set, whether via
     * `setValue`, an animation, or `Animated.event`.  Useful for compensating
     * things like the start of a pan gesture.
     */
    setOffset(offset) {
        this._offset = offset
    }

    /**
     * Merges the offset value into the base value and resets the offset to zero.
     * The final output of the value is unchanged.
     */
    flattenOffset() {
        this._value += this._offset
        this._offset = 0
    }

    /**
     * Adds an asynchronous listener to the value so you can observe updates from
     * animations.  This is useful because there is no way to
     * synchronously read the value because it might be driven natively.
     */
    addListener(callback) {
        var id = guid()
        this._listeners[id] = callback
        return id
    }

    removeListener(id) {
        delete this._listeners[id]
    }

    removeAllListeners() {
        this._listeners = {}
    }

    /**
     * Stops any running animation or tracking.  `callback` is invoked with the
     * final value after stopping the animation, which is useful for updating
     * state to match the animation position with layout.
     */
    stopAnimation(callback) {
        this.stopTracking()
        this._animation && this._animation.stop()
        this._animation = null
        callback && callback(this.__getValue())
    }

    /**
     * Interpolates the value before updating the property, e.g. mapping 0-1 to
     * 0-10.
     */
    interpolate(config) {
        return new AnimatedInterpolation(this, Interpolation.create(config))
    }

    /**
     * Typically only used internally, but could be used by a custom Animation
     * class.
     */
    animate(animation, callback) {
        var handle = null
        if (animation.__isInteraction) handle = InteractionManager.current.createInteractionHandle()
        var previousAnimation = this._animation
        this._animation && this._animation.stop()
        this._animation = animation
        animation.start(
            this._value,
            value => this._updateValue(value),
            result => {
                this._animation = null
                if (handle !== null) InteractionManager.current.clearInteractionHandle(handle)
                callback && callback(result)
            },
            previousAnimation,
        )
    }

    /**
     * Typically only used internally.
     */
    stopTracking() {
        this._tracking && this._tracking.__detach()
        this._tracking = null
    }

    /**
     * Typically only used internally.
     */
    track(tracking) {
        this.stopTracking()
        this._tracking = tracking
    }

    _updateValue(value) {
        this._value = value
        _flush(this)
        for (var key in this._listeners)
            this._listeners[key]({ value: this.__getValue() })
    }
}

export default AnimatedValue
