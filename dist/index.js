(function () {
	'use strict';

	const EMPTY_OBJ = {};
	const EMPTY_ARR = [];
	const IS_NON_DIMENSIONAL = /acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord/i;

	/**
	 * Assign properties from `props` to `obj`
	 * @template O, P The obj and props types
	 * @param {O} obj The object to copy properties to
	 * @param {P} props The object to copy properties from
	 * @returns {O & P}
	 */
	function assign(obj, props) {
		for (let i in props) obj[i] = props[i];
		return /** @type {O & P} */ (obj);
	}

	/**
	 * Remove a child node from its parent if attached. This is a workaround for
	 * IE11 which doesn't support `Element.prototype.remove()`. Using this function
	 * is smaller than including a dedicated polyfill.
	 * @param {Node} node The node to remove
	 */
	function removeNode(node) {
		let parentNode = node.parentNode;
		if (parentNode) parentNode.removeChild(node);
	}

	/**
	 * Find the closest error boundary to a thrown error and call it
	 * @param {object} error The thrown value
	 * @param {import('../internal').VNode} vnode The vnode that threw
	 * the error that was caught (except for unmounting when this parameter
	 * is the highest parent that was being unmounted)
	 */
	function _catchError(error, vnode) {
		/** @type {import('../internal').Component} */
		let component, hasCaught;

		for (; (vnode = vnode._parent); ) {
			if ((component = vnode._component) && !component._processingException) {
				try {
					if (
						component.constructor &&
						component.constructor.getDerivedStateFromError != null
					) {
						hasCaught = true;
						component.setState(
							component.constructor.getDerivedStateFromError(error)
						);
					}

					if (component.componentDidCatch != null) {
						hasCaught = true;
						component.componentDidCatch(error);
					}

					if (hasCaught)
						return enqueueRender((component._pendingError = component));
				} catch (e) {
					error = e;
				}
			}
		}

		throw error;
	}

	/**
	 * The `option` object can potentially contain callback functions
	 * that are called during various stages of our renderer. This is the
	 * foundation on which all our addons like `preact/debug`, `preact/compat`,
	 * and `preact/hooks` are based on. See the `Options` type in `internal.d.ts`
	 * for a full list of available option hooks (most editors/IDEs allow you to
	 * ctrl+click or cmd+click on mac the type definition below).
	 * @type {import('./internal').Options}
	 */
	const options = {
		_catchError
	};

	/**
	 * Create an virtual node (used for JSX)
	 * @param {import('./internal').VNode["type"]} type The node name or Component
	 * constructor for this virtual node
	 * @param {object | null | undefined} [props] The properties of the virtual node
	 * @param {Array<import('.').ComponentChildren>} [children] The children of the virtual node
	 * @returns {import('./internal').VNode}
	 */
	function createElement(type, props, children) {
		let normalizedProps = {},
			i;
		for (i in props) {
			if (i !== 'key' && i !== 'ref') normalizedProps[i] = props[i];
		}

		if (arguments.length > 3) {
			children = [children];
			// https://github.com/preactjs/preact/issues/1916
			for (i = 3; i < arguments.length; i++) {
				children.push(arguments[i]);
			}
		}
		if (children != null) {
			normalizedProps.children = children;
		}

		// If a Component VNode, check for and apply defaultProps
		// Note: type may be undefined in development, must never error here.
		if (typeof type == 'function' && type.defaultProps != null) {
			for (i in type.defaultProps) {
				if (normalizedProps[i] === undefined) {
					normalizedProps[i] = type.defaultProps[i];
				}
			}
		}

		return createVNode(
			type,
			normalizedProps,
			props && props.key,
			props && props.ref,
			null
		);
	}

	/**
	 * Create a VNode (used internally by Preact)
	 * @param {import('./internal').VNode["type"]} type The node name or Component
	 * Constructor for this virtual node
	 * @param {object | string | number | null} props The properties of this virtual node.
	 * If this virtual node represents a text node, this is the text of the node (string or number).
	 * @param {string | number | null} key The key for this virtual node, used when
	 * diffing it against its children
	 * @param {import('./internal').VNode["ref"]} ref The ref property that will
	 * receive a reference to its created child
	 * @returns {import('./internal').VNode}
	 */
	function createVNode(type, props, key, ref, original) {
		// V8 seems to be better at detecting type shapes if the object is allocated from the same call site
		// Do not inline into createElement and coerceToVNode!
		const vnode = {
			type,
			props,
			key,
			ref,
			_children: null,
			_parent: null,
			_depth: 0,
			_dom: null,
			// _nextDom must be initialized to undefined b/c it will eventually
			// be set to dom.nextSibling which can return `null` and it is important
			// to be able to distinguish between an uninitialized _nextDom and
			// a _nextDom that has been set to `null`
			_nextDom: undefined,
			_component: null,
			constructor: undefined,
			_original: original
		};

		if (original == null) vnode._original = vnode;
		if (options.vnode) options.vnode(vnode);

		return vnode;
	}

	function Fragment(props) {
		return props.children;
	}

	/**
	 * Base Component class. Provides `setState()` and `forceUpdate()`, which
	 * trigger rendering
	 * @param {object} props The initial component props
	 * @param {object} context The initial context from parent components'
	 * getChildContext
	 */
	function Component(props, context) {
		this.props = props;
		this.context = context;
	}

	/**
	 * Update component state and schedule a re-render.
	 * @param {object | ((s: object, p: object) => object)} update A hash of state
	 * properties to update with new values or a function that given the current
	 * state and props returns a new partial state
	 * @param {() => void} [callback] A function to be called once component state is
	 * updated
	 */
	Component.prototype.setState = function(update, callback) {
		// only clone state when copying to nextState the first time.
		let s;
		if (this._nextState !== this.state) {
			s = this._nextState;
		} else {
			s = this._nextState = assign({}, this.state);
		}

		if (typeof update == 'function') {
			update = update(s, this.props);
		}

		if (update) {
			assign(s, update);
		}

		// Skip update if updater function returned null
		if (update == null) return;

		if (this._vnode) {
			if (callback) this._renderCallbacks.push(callback);
			enqueueRender(this);
		}
	};

	/**
	 * Immediately perform a synchronous re-render of the component
	 * @param {() => void} [callback] A function to be called after component is
	 * re-rendered
	 */
	Component.prototype.forceUpdate = function(callback) {
		if (this._vnode) {
			// Set render mode so that we can differentiate where the render request
			// is coming from. We need this because forceUpdate should never call
			// shouldComponentUpdate
			this._force = true;
			if (callback) this._renderCallbacks.push(callback);
			enqueueRender(this);
		}
	};

	/**
	 * Accepts `props` and `state`, and returns a new Virtual DOM tree to build.
	 * Virtual DOM is generally constructed via [JSX](http://jasonformat.com/wtf-is-jsx).
	 * @param {object} props Props (eg: JSX attributes) received from parent
	 * element/component
	 * @param {object} state The component's current state
	 * @param {object} context Context object, as returned by the nearest
	 * ancestor's `getChildContext()`
	 * @returns {import('./index').ComponentChildren | void}
	 */
	Component.prototype.render = Fragment;

	/**
	 * @param {import('./internal').VNode} vnode
	 * @param {number | null} [childIndex]
	 */
	function getDomSibling(vnode, childIndex) {
		if (childIndex == null) {
			// Use childIndex==null as a signal to resume the search from the vnode's sibling
			return vnode._parent
				? getDomSibling(vnode._parent, vnode._parent._children.indexOf(vnode) + 1)
				: null;
		}

		let sibling;
		for (; childIndex < vnode._children.length; childIndex++) {
			sibling = vnode._children[childIndex];

			if (sibling != null && sibling._dom != null) {
				// Since updateParentDomPointers keeps _dom pointer correct,
				// we can rely on _dom to tell us if this subtree contains a
				// rendered DOM node, and what the first rendered DOM node is
				return sibling._dom;
			}
		}

		// If we get here, we have not found a DOM node in this vnode's children.
		// We must resume from this vnode's sibling (in it's parent _children array)
		// Only climb up and search the parent if we aren't searching through a DOM
		// VNode (meaning we reached the DOM parent of the original vnode that began
		// the search)
		return typeof vnode.type == 'function' ? getDomSibling(vnode) : null;
	}

	/**
	 * Trigger in-place re-rendering of a component.
	 * @param {import('./internal').Component} component The component to rerender
	 */
	function renderComponent(component) {
		let vnode = component._vnode,
			oldDom = vnode._dom,
			parentDom = component._parentDom;

		if (parentDom) {
			let commitQueue = [];
			const oldVNode = assign({}, vnode);
			oldVNode._original = oldVNode;

			let newDom = diff(
				parentDom,
				vnode,
				oldVNode,
				component._globalContext,
				parentDom.ownerSVGElement !== undefined,
				null,
				commitQueue,
				oldDom == null ? getDomSibling(vnode) : oldDom
			);
			commitRoot(commitQueue, vnode);

			if (newDom != oldDom) {
				updateParentDomPointers(vnode);
			}
		}
	}

	/**
	 * @param {import('./internal').VNode} vnode
	 */
	function updateParentDomPointers(vnode) {
		if ((vnode = vnode._parent) != null && vnode._component != null) {
			vnode._dom = vnode._component.base = null;
			for (let i = 0; i < vnode._children.length; i++) {
				let child = vnode._children[i];
				if (child != null && child._dom != null) {
					vnode._dom = vnode._component.base = child._dom;
					break;
				}
			}

			return updateParentDomPointers(vnode);
		}
	}

	/**
	 * The render queue
	 * @type {Array<import('./internal').Component>}
	 */
	let rerenderQueue = [];
	let rerenderCount = 0;

	/**
	 * Asynchronously schedule a callback
	 * @type {(cb: () => void) => void}
	 */
	/* istanbul ignore next */
	// Note the following line isn't tree-shaken by rollup cuz of rollup/rollup#2566
	const defer =
		typeof Promise == 'function'
			? Promise.prototype.then.bind(Promise.resolve())
			: setTimeout;

	/*
	 * The value of `Component.debounce` must asynchronously invoke the passed in callback. It is
	 * important that contributors to Preact can consistently reason about what calls to `setState`, etc.
	 * do, and when their effects will be applied. See the links below for some further reading on designing
	 * asynchronous APIs.
	 * * [Designing APIs for Asynchrony](https://blog.izs.me/2013/08/designing-apis-for-asynchrony)
	 * * [Callbacks synchronous and asynchronous](https://blog.ometer.com/2011/07/24/callbacks-synchronous-and-asynchronous/)
	 */

	let prevDebounce;

	/**
	 * Enqueue a rerender of a component
	 * @param {import('./internal').Component} c The component to rerender
	 */
	function enqueueRender(c) {
		if (
			(!c._dirty &&
				(c._dirty = true) &&
				rerenderQueue.push(c) &&
				!rerenderCount++) ||
			prevDebounce !== options.debounceRendering
		) {
			prevDebounce = options.debounceRendering;
			(prevDebounce || defer)(process);
		}
	}

	/** Flush the render queue by rerendering all queued components */
	function process() {
		let queue;
		while ((rerenderCount = rerenderQueue.length)) {
			queue = rerenderQueue.sort((a, b) => a._vnode._depth - b._vnode._depth);
			rerenderQueue = [];
			// Don't update `renderCount` yet. Keep its value non-zero to prevent unnecessary
			// process() calls from getting scheduled while `queue` is still being consumed.
			queue.some(c => {
				if (c._dirty) renderComponent(c);
			});
		}
	}

	/**
	 * Diff the children of a virtual node
	 * @param {import('../internal').PreactElement} parentDom The DOM element whose
	 * children are being diffed
	 * @param {import('../internal').VNode} newParentVNode The new virtual
	 * node whose children should be diff'ed against oldParentVNode
	 * @param {import('../internal').VNode} oldParentVNode The old virtual
	 * node whose children should be diff'ed against newParentVNode
	 * @param {object} globalContext The current context object - modified by getChildContext
	 * @param {boolean} isSvg Whether or not this DOM node is an SVG node
	 * @param {Array<import('../internal').PreactElement>} excessDomChildren
	 * @param {Array<import('../internal').Component>} commitQueue List of components
	 * which have callbacks to invoke in commitRoot
	 * @param {Node | Text} oldDom The current attached DOM
	 * element any new dom elements should be placed around. Likely `null` on first
	 * render (except when hydrating). Can be a sibling DOM element when diffing
	 * Fragments that have siblings. In most cases, it starts out as `oldChildren[0]._dom`.
	 * @param {boolean} isHydrating Whether or not we are in hydration
	 */
	function diffChildren(
		parentDom,
		newParentVNode,
		oldParentVNode,
		globalContext,
		isSvg,
		excessDomChildren,
		commitQueue,
		oldDom,
		isHydrating
	) {
		let i, j, oldVNode, newDom, sibDom, firstChildDom, refs;

		// This is a compression of oldParentVNode!=null && oldParentVNode != EMPTY_OBJ && oldParentVNode._children || EMPTY_ARR
		// as EMPTY_OBJ._children should be `undefined`.
		let oldChildren = (oldParentVNode && oldParentVNode._children) || EMPTY_ARR;

		let oldChildrenLength = oldChildren.length;

		// Only in very specific places should this logic be invoked (top level `render` and `diffElementNodes`).
		// I'm using `EMPTY_OBJ` to signal when `diffChildren` is invoked in these situations. I can't use `null`
		// for this purpose, because `null` is a valid value for `oldDom` which can mean to skip to this logic
		// (e.g. if mounting a new tree in which the old DOM should be ignored (usually for Fragments).
		if (oldDom == EMPTY_OBJ) {
			if (excessDomChildren != null) {
				oldDom = excessDomChildren[0];
			} else if (oldChildrenLength) {
				oldDom = getDomSibling(oldParentVNode, 0);
			} else {
				oldDom = null;
			}
		}

		i = 0;
		newParentVNode._children = toChildArray(
			newParentVNode._children,
			childVNode => {
				if (childVNode != null) {
					childVNode._parent = newParentVNode;
					childVNode._depth = newParentVNode._depth + 1;

					// Check if we find a corresponding element in oldChildren.
					// If found, delete the array item by setting to `undefined`.
					// We use `undefined`, as `null` is reserved for empty placeholders
					// (holes).
					oldVNode = oldChildren[i];

					if (
						oldVNode === null ||
						(oldVNode &&
							childVNode.key == oldVNode.key &&
							childVNode.type === oldVNode.type)
					) {
						oldChildren[i] = undefined;
					} else {
						// Either oldVNode === undefined or oldChildrenLength > 0,
						// so after this loop oldVNode == null or oldVNode is a valid value.
						for (j = 0; j < oldChildrenLength; j++) {
							oldVNode = oldChildren[j];
							// If childVNode is unkeyed, we only match similarly unkeyed nodes, otherwise we match by key.
							// We always match by type (in either case).
							if (
								oldVNode &&
								childVNode.key == oldVNode.key &&
								childVNode.type === oldVNode.type
							) {
								oldChildren[j] = undefined;
								break;
							}
							oldVNode = null;
						}
					}

					oldVNode = oldVNode || EMPTY_OBJ;

					// Morph the old element into the new one, but don't append it to the dom yet
					newDom = diff(
						parentDom,
						childVNode,
						oldVNode,
						globalContext,
						isSvg,
						excessDomChildren,
						commitQueue,
						oldDom,
						isHydrating
					);

					if ((j = childVNode.ref) && oldVNode.ref != j) {
						if (!refs) refs = [];
						if (oldVNode.ref) refs.push(oldVNode.ref, null, childVNode);
						refs.push(j, childVNode._component || newDom, childVNode);
					}

					// Only proceed if the vnode has not been unmounted by `diff()` above.
					if (newDom != null) {
						if (firstChildDom == null) {
							firstChildDom = newDom;
						}

						let nextDom;
						if (childVNode._nextDom !== undefined) {
							// Only Fragments or components that return Fragment like VNodes will
							// have a non-undefined _nextDom. Continue the diff from the sibling
							// of last DOM child of this child VNode
							nextDom = childVNode._nextDom;

							// Eagerly cleanup _nextDom. We don't need to persist the value because
							// it is only used by `diffChildren` to determine where to resume the diff after
							// diffing Components and Fragments. Once we store it the nextDOM local var, we
							// can clean up the property
							childVNode._nextDom = undefined;
						} else if (
							excessDomChildren == oldVNode ||
							newDom != oldDom ||
							newDom.parentNode == null
						) {
							// NOTE: excessDomChildren==oldVNode above:
							// This is a compression of excessDomChildren==null && oldVNode==null!
							// The values only have the same type when `null`.

							outer: if (oldDom == null || oldDom.parentNode !== parentDom) {
								parentDom.appendChild(newDom);
								nextDom = null;
							} else {
								// `j<oldChildrenLength; j+=2` is an alternative to `j++<oldChildrenLength/2`
								for (
									sibDom = oldDom, j = 0;
									(sibDom = sibDom.nextSibling) && j < oldChildrenLength;
									j += 2
								) {
									if (sibDom == newDom) {
										break outer;
									}
								}
								parentDom.insertBefore(newDom, oldDom);
								nextDom = oldDom;
							}

							// Browsers will infer an option's `value` from `textContent` when
							// no value is present. This essentially bypasses our code to set it
							// later in `diff()`. It works fine in all browsers except for IE11
							// where it breaks setting `select.value`. There it will be always set
							// to an empty string. Re-applying an options value will fix that, so
							// there are probably some internal data structures that aren't
							// updated properly.
							//
							// To fix it we make sure to reset the inferred value, so that our own
							// value check in `diff()` won't be skipped.
							if (newParentVNode.type == 'option') {
								parentDom.value = '';
							}
						}

						// If we have pre-calculated the nextDOM node, use it. Else calculate it now
						// Strictly check for `undefined` here cuz `null` is a valid value of `nextDom`.
						// See more detail in create-element.js:createVNode
						if (nextDom !== undefined) {
							oldDom = nextDom;
						} else {
							oldDom = newDom.nextSibling;
						}

						if (typeof newParentVNode.type == 'function') {
							// Because the newParentVNode is Fragment-like, we need to set it's
							// _nextDom property to the nextSibling of its last child DOM node.
							//
							// `oldDom` contains the correct value here because if the last child
							// is a Fragment-like, then oldDom has already been set to that child's _nextDom.
							// If the last child is a DOM VNode, then oldDom will be set to that DOM
							// node's nextSibling.

							newParentVNode._nextDom = oldDom;
						}
					} else if (
						oldDom &&
						oldVNode._dom == oldDom &&
						oldDom.parentNode != parentDom
					) {
						// The above condition is to handle null placeholders. See test in placeholder.test.js:
						// `efficiently replace null placeholders in parent rerenders`
						oldDom = getDomSibling(oldVNode);
					}
				}

				i++;
				return childVNode;
			}
		);

		newParentVNode._dom = firstChildDom;

		// Remove children that are not part of any vnode.
		if (excessDomChildren != null && typeof newParentVNode.type != 'function') {
			for (i = excessDomChildren.length; i--; ) {
				if (excessDomChildren[i] != null) removeNode(excessDomChildren[i]);
			}
		}

		// Remove remaining oldChildren if there are any.
		for (i = oldChildrenLength; i--; ) {
			if (oldChildren[i] != null) unmount(oldChildren[i], oldChildren[i]);
		}

		// Set refs only after unmount
		if (refs) {
			for (i = 0; i < refs.length; i++) {
				applyRef(refs[i], refs[++i], refs[++i]);
			}
		}
	}

	/**
	 * Flatten and loop through the children of a virtual node
	 * @param {import('../index').ComponentChildren} children The unflattened
	 * children of a virtual node
	 * @param {(vnode: import('../internal').VNode) => import('../internal').VNode} [callback]
	 * A function to invoke for each child before it is added to the flattened list.
	 * @param {Array<import('../internal').VNode | string | number>} [flattened] An flat array of children to modify
	 * @returns {import('../internal').VNode[]}
	 */
	function toChildArray(children, callback, flattened) {
		if (flattened == null) flattened = [];

		if (children == null || typeof children == 'boolean') {
			if (callback) flattened.push(callback(null));
		} else if (Array.isArray(children)) {
			for (let i = 0; i < children.length; i++) {
				toChildArray(children[i], callback, flattened);
			}
		} else if (!callback) {
			flattened.push(children);
		} else if (typeof children == 'string' || typeof children == 'number') {
			flattened.push(callback(createVNode(null, children, null, null, children)));
		} else if (children._dom != null || children._component != null) {
			flattened.push(
				callback(
					createVNode(
						children.type,
						children.props,
						children.key,
						null,
						children._original
					)
				)
			);
		} else {
			flattened.push(callback(children));
		}

		return flattened;
	}

	/**
	 * Diff the old and new properties of a VNode and apply changes to the DOM node
	 * @param {import('../internal').PreactElement} dom The DOM node to apply
	 * changes to
	 * @param {object} newProps The new props
	 * @param {object} oldProps The old props
	 * @param {boolean} isSvg Whether or not this node is an SVG node
	 * @param {boolean} hydrate Whether or not we are in hydration mode
	 */
	function diffProps(dom, newProps, oldProps, isSvg, hydrate) {
		let i;

		for (i in oldProps) {
			if (i !== 'children' && i !== 'key' && !(i in newProps)) {
				setProperty(dom, i, null, oldProps[i], isSvg);
			}
		}

		for (i in newProps) {
			if (
				(!hydrate || typeof newProps[i] == 'function') &&
				i !== 'children' &&
				i !== 'key' &&
				i !== 'value' &&
				i !== 'checked' &&
				oldProps[i] !== newProps[i]
			) {
				setProperty(dom, i, newProps[i], oldProps[i], isSvg);
			}
		}
	}

	function setStyle(style, key, value) {
		if (key[0] === '-') {
			style.setProperty(key, value);
		} else if (
			typeof value == 'number' &&
			IS_NON_DIMENSIONAL.test(key) === false
		) {
			style[key] = value + 'px';
		} else if (value == null) {
			style[key] = '';
		} else {
			style[key] = value;
		}
	}

	/**
	 * Set a property value on a DOM node
	 * @param {import('../internal').PreactElement} dom The DOM node to modify
	 * @param {string} name The name of the property to set
	 * @param {*} value The value to set the property to
	 * @param {*} oldValue The old value the property had
	 * @param {boolean} isSvg Whether or not this DOM node is an SVG node or not
	 */
	function setProperty(dom, name, value, oldValue, isSvg) {
		let s, useCapture, nameLower;

		if (isSvg) {
			if (name === 'className') {
				name = 'class';
			}
		} else if (name === 'class') {
			name = 'className';
		}

		if (name === 'style') {
			s = dom.style;

			if (typeof value == 'string') {
				s.cssText = value;
			} else {
				if (typeof oldValue == 'string') {
					s.cssText = '';
					oldValue = null;
				}

				if (oldValue) {
					for (let i in oldValue) {
						if (!(value && i in value)) {
							setStyle(s, i, '');
						}
					}
				}

				if (value) {
					for (let i in value) {
						if (!oldValue || value[i] !== oldValue[i]) {
							setStyle(s, i, value[i]);
						}
					}
				}
			}
		}
		// Benchmark for comparison: https://esbench.com/bench/574c954bdb965b9a00965ac6
		else if (name[0] === 'o' && name[1] === 'n') {
			useCapture = name !== (name = name.replace(/Capture$/, ''));
			nameLower = name.toLowerCase();
			name = (nameLower in dom ? nameLower : name).slice(2);

			if (value) {
				if (!oldValue) dom.addEventListener(name, eventProxy, useCapture);
				(dom._listeners || (dom._listeners = {}))[name] = value;
			} else {
				dom.removeEventListener(name, eventProxy, useCapture);
			}
		} else if (
			name !== 'list' &&
			name !== 'tagName' &&
			// HTMLButtonElement.form and HTMLInputElement.form are read-only but can be set using
			// setAttribute
			name !== 'form' &&
			name !== 'type' &&
			name !== 'size' &&
			!isSvg &&
			name in dom
		) {
			dom[name] = value == null ? '' : value;
		} else if (typeof value != 'function' && name !== 'dangerouslySetInnerHTML') {
			if (name !== (name = name.replace(/^xlink:?/, ''))) {
				if (value == null || value === false) {
					dom.removeAttributeNS(
						'http://www.w3.org/1999/xlink',
						name.toLowerCase()
					);
				} else {
					dom.setAttributeNS(
						'http://www.w3.org/1999/xlink',
						name.toLowerCase(),
						value
					);
				}
			} else if (
				value == null ||
				(value === false &&
					// ARIA-attributes have a different notion of boolean values.
					// The value `false` is different from the attribute not
					// existing on the DOM, so we can't remove it. For non-boolean
					// ARIA-attributes we could treat false as a removal, but the
					// amount of exceptions would cost us too many bytes. On top of
					// that other VDOM frameworks also always stringify `false`.
					!/^ar/.test(name))
			) {
				dom.removeAttribute(name);
			} else {
				dom.setAttribute(name, value);
			}
		}
	}

	/**
	 * Proxy an event to hooked event handlers
	 * @param {Event} e The event object from the browser
	 * @private
	 */
	function eventProxy(e) {
		this._listeners[e.type](options.event ? options.event(e) : e);
	}

	/**
	 * Diff two virtual nodes and apply proper changes to the DOM
	 * @param {import('../internal').PreactElement} parentDom The parent of the DOM element
	 * @param {import('../internal').VNode} newVNode The new virtual node
	 * @param {import('../internal').VNode} oldVNode The old virtual node
	 * @param {object} globalContext The current context object. Modified by getChildContext
	 * @param {boolean} isSvg Whether or not this element is an SVG node
	 * @param {Array<import('../internal').PreactElement>} excessDomChildren
	 * @param {Array<import('../internal').Component>} commitQueue List of components
	 * which have callbacks to invoke in commitRoot
	 * @param {Element | Text} oldDom The current attached DOM
	 * element any new dom elements should be placed around. Likely `null` on first
	 * render (except when hydrating). Can be a sibling DOM element when diffing
	 * Fragments that have siblings. In most cases, it starts out as `oldChildren[0]._dom`.
	 * @param {boolean} [isHydrating] Whether or not we are in hydration
	 */
	function diff(
		parentDom,
		newVNode,
		oldVNode,
		globalContext,
		isSvg,
		excessDomChildren,
		commitQueue,
		oldDom,
		isHydrating
	) {
		let tmp,
			newType = newVNode.type;

		// When passing through createElement it assigns the object
		// constructor as undefined. This to prevent JSON-injection.
		if (newVNode.constructor !== undefined) return null;

		if ((tmp = options._diff)) tmp(newVNode);

		try {
			outer: if (typeof newType == 'function') {
				let c, isNew, oldProps, oldState, snapshot, clearProcessingException;
				let newProps = newVNode.props;

				// Necessary for createContext api. Setting this property will pass
				// the context value as `this.context` just for this component.
				tmp = newType.contextType;
				let provider = tmp && globalContext[tmp._id];
				let componentContext = tmp
					? provider
						? provider.props.value
						: tmp._defaultValue
					: globalContext;

				// Get component and set it to `c`
				if (oldVNode._component) {
					c = newVNode._component = oldVNode._component;
					clearProcessingException = c._processingException = c._pendingError;
				} else {
					// Instantiate the new component
					if ('prototype' in newType && newType.prototype.render) {
						newVNode._component = c = new newType(newProps, componentContext); // eslint-disable-line new-cap
					} else {
						newVNode._component = c = new Component(newProps, componentContext);
						c.constructor = newType;
						c.render = doRender;
					}
					if (provider) provider.sub(c);

					c.props = newProps;
					if (!c.state) c.state = {};
					c.context = componentContext;
					c._globalContext = globalContext;
					isNew = c._dirty = true;
					c._renderCallbacks = [];
				}

				// Invoke getDerivedStateFromProps
				if (c._nextState == null) {
					c._nextState = c.state;
				}
				if (newType.getDerivedStateFromProps != null) {
					if (c._nextState == c.state) {
						c._nextState = assign({}, c._nextState);
					}

					assign(
						c._nextState,
						newType.getDerivedStateFromProps(newProps, c._nextState)
					);
				}

				oldProps = c.props;
				oldState = c.state;

				// Invoke pre-render lifecycle methods
				if (isNew) {
					if (
						newType.getDerivedStateFromProps == null &&
						c.componentWillMount != null
					) {
						c.componentWillMount();
					}

					if (c.componentDidMount != null) {
						c._renderCallbacks.push(c.componentDidMount);
					}
				} else {
					if (
						newType.getDerivedStateFromProps == null &&
						newProps !== oldProps &&
						c.componentWillReceiveProps != null
					) {
						c.componentWillReceiveProps(newProps, componentContext);
					}

					if (
						(!c._force &&
							c.shouldComponentUpdate != null &&
							c.shouldComponentUpdate(
								newProps,
								c._nextState,
								componentContext
							) === false) ||
						(newVNode._original === oldVNode._original && !c._processingException)
					) {
						c.props = newProps;
						c.state = c._nextState;
						// More info about this here: https://gist.github.com/JoviDeCroock/bec5f2ce93544d2e6070ef8e0036e4e8
						if (newVNode._original !== oldVNode._original) c._dirty = false;
						c._vnode = newVNode;
						newVNode._dom = oldVNode._dom;
						newVNode._children = oldVNode._children;
						if (c._renderCallbacks.length) {
							commitQueue.push(c);
						}

						for (tmp = 0; tmp < newVNode._children.length; tmp++) {
							if (newVNode._children[tmp]) {
								newVNode._children[tmp]._parent = newVNode;
							}
						}

						break outer;
					}

					if (c.componentWillUpdate != null) {
						c.componentWillUpdate(newProps, c._nextState, componentContext);
					}

					if (c.componentDidUpdate != null) {
						c._renderCallbacks.push(() => {
							c.componentDidUpdate(oldProps, oldState, snapshot);
						});
					}
				}

				c.context = componentContext;
				c.props = newProps;
				c.state = c._nextState;

				if ((tmp = options._render)) tmp(newVNode);

				c._dirty = false;
				c._vnode = newVNode;
				c._parentDom = parentDom;

				tmp = c.render(c.props, c.state, c.context);
				let isTopLevelFragment =
					tmp != null && tmp.type == Fragment && tmp.key == null;
				newVNode._children = isTopLevelFragment
					? tmp.props.children
					: Array.isArray(tmp)
					? tmp
					: [tmp];

				if (c.getChildContext != null) {
					globalContext = assign(assign({}, globalContext), c.getChildContext());
				}

				if (!isNew && c.getSnapshotBeforeUpdate != null) {
					snapshot = c.getSnapshotBeforeUpdate(oldProps, oldState);
				}

				diffChildren(
					parentDom,
					newVNode,
					oldVNode,
					globalContext,
					isSvg,
					excessDomChildren,
					commitQueue,
					oldDom,
					isHydrating
				);

				c.base = newVNode._dom;

				if (c._renderCallbacks.length) {
					commitQueue.push(c);
				}

				if (clearProcessingException) {
					c._pendingError = c._processingException = null;
				}

				c._force = false;
			} else if (
				excessDomChildren == null &&
				newVNode._original === oldVNode._original
			) {
				newVNode._children = oldVNode._children;
				newVNode._dom = oldVNode._dom;
			} else {
				newVNode._dom = diffElementNodes(
					oldVNode._dom,
					newVNode,
					oldVNode,
					globalContext,
					isSvg,
					excessDomChildren,
					commitQueue,
					isHydrating
				);
			}

			if ((tmp = options.diffed)) tmp(newVNode);
		} catch (e) {
			newVNode._original = null;
			options._catchError(e, newVNode, oldVNode);
		}

		return newVNode._dom;
	}

	/**
	 * @param {Array<import('../internal').Component>} commitQueue List of components
	 * which have callbacks to invoke in commitRoot
	 * @param {import('../internal').VNode} root
	 */
	function commitRoot(commitQueue, root) {
		if (options._commit) options._commit(root, commitQueue);

		commitQueue.some(c => {
			try {
				commitQueue = c._renderCallbacks;
				c._renderCallbacks = [];
				commitQueue.some(cb => {
					cb.call(c);
				});
			} catch (e) {
				options._catchError(e, c._vnode);
			}
		});
	}

	/**
	 * Diff two virtual nodes representing DOM element
	 * @param {import('../internal').PreactElement} dom The DOM element representing
	 * the virtual nodes being diffed
	 * @param {import('../internal').VNode} newVNode The new virtual node
	 * @param {import('../internal').VNode} oldVNode The old virtual node
	 * @param {object} globalContext The current context object
	 * @param {boolean} isSvg Whether or not this DOM node is an SVG node
	 * @param {*} excessDomChildren
	 * @param {Array<import('../internal').Component>} commitQueue List of components
	 * which have callbacks to invoke in commitRoot
	 * @param {boolean} isHydrating Whether or not we are in hydration
	 * @returns {import('../internal').PreactElement}
	 */
	function diffElementNodes(
		dom,
		newVNode,
		oldVNode,
		globalContext,
		isSvg,
		excessDomChildren,
		commitQueue,
		isHydrating
	) {
		let i;
		let oldProps = oldVNode.props;
		let newProps = newVNode.props;

		// Tracks entering and exiting SVG namespace when descending through the tree.
		isSvg = newVNode.type === 'svg' || isSvg;

		if (excessDomChildren != null) {
			for (i = 0; i < excessDomChildren.length; i++) {
				const child = excessDomChildren[i];

				// if newVNode matches an element in excessDomChildren or the `dom`
				// argument matches an element in excessDomChildren, remove it from
				// excessDomChildren so it isn't later removed in diffChildren
				if (
					child != null &&
					((newVNode.type === null
						? child.nodeType === 3
						: child.localName === newVNode.type) ||
						dom == child)
				) {
					dom = child;
					excessDomChildren[i] = null;
					break;
				}
			}
		}

		if (dom == null) {
			if (newVNode.type === null) {
				return document.createTextNode(newProps);
			}

			dom = isSvg
				? document.createElementNS('http://www.w3.org/2000/svg', newVNode.type)
				: document.createElement(
						newVNode.type,
						newProps.is && { is: newProps.is }
				  );
			// we created a new parent, so none of the previously attached children can be reused:
			excessDomChildren = null;
			// we are creating a new node, so we can assume this is a new subtree (in case we are hydrating), this deopts the hydrate
			isHydrating = false;
		}

		if (newVNode.type === null) {
			if (oldProps !== newProps && dom.data != newProps) {
				dom.data = newProps;
			}
		} else {
			if (excessDomChildren != null) {
				excessDomChildren = EMPTY_ARR.slice.call(dom.childNodes);
			}

			oldProps = oldVNode.props || EMPTY_OBJ;

			let oldHtml = oldProps.dangerouslySetInnerHTML;
			let newHtml = newProps.dangerouslySetInnerHTML;

			// During hydration, props are not diffed at all (including dangerouslySetInnerHTML)
			// @TODO we should warn in debug mode when props don't match here.
			if (!isHydrating) {
				if (oldProps === EMPTY_OBJ) {
					oldProps = {};
					for (let i = 0; i < dom.attributes.length; i++) {
						oldProps[dom.attributes[i].name] = dom.attributes[i].value;
					}
				}

				if (newHtml || oldHtml) {
					// Avoid re-applying the same '__html' if it did not changed between re-render
					if (!newHtml || !oldHtml || newHtml.__html != oldHtml.__html) {
						dom.innerHTML = (newHtml && newHtml.__html) || '';
					}
				}
			}

			diffProps(dom, newProps, oldProps, isSvg, isHydrating);

			// If the new vnode didn't have dangerouslySetInnerHTML, diff its children
			if (newHtml) {
				newVNode._children = [];
			} else {
				newVNode._children = newVNode.props.children;
				diffChildren(
					dom,
					newVNode,
					oldVNode,
					globalContext,
					newVNode.type === 'foreignObject' ? false : isSvg,
					excessDomChildren,
					commitQueue,
					EMPTY_OBJ,
					isHydrating
				);
			}

			// (as above, don't diff props during hydration)
			if (!isHydrating) {
				if (
					'value' in newProps &&
					(i = newProps.value) !== undefined &&
					i !== dom.value
				) {
					setProperty(dom, 'value', i, oldProps.value, false);
				}
				if (
					'checked' in newProps &&
					(i = newProps.checked) !== undefined &&
					i !== dom.checked
				) {
					setProperty(dom, 'checked', i, oldProps.checked, false);
				}
			}
		}

		return dom;
	}

	/**
	 * Invoke or update a ref, depending on whether it is a function or object ref.
	 * @param {object|function} ref
	 * @param {any} value
	 * @param {import('../internal').VNode} vnode
	 */
	function applyRef(ref, value, vnode) {
		try {
			if (typeof ref == 'function') ref(value);
			else ref.current = value;
		} catch (e) {
			options._catchError(e, vnode);
		}
	}

	/**
	 * Unmount a virtual node from the tree and apply DOM changes
	 * @param {import('../internal').VNode} vnode The virtual node to unmount
	 * @param {import('../internal').VNode} parentVNode The parent of the VNode that
	 * initiated the unmount
	 * @param {boolean} [skipRemove] Flag that indicates that a parent node of the
	 * current element is already detached from the DOM.
	 */
	function unmount(vnode, parentVNode, skipRemove) {
		let r;
		if (options.unmount) options.unmount(vnode);

		if ((r = vnode.ref)) {
			if (!r.current || r.current === vnode._dom) applyRef(r, null, parentVNode);
		}

		let dom;
		if (!skipRemove && typeof vnode.type != 'function') {
			skipRemove = (dom = vnode._dom) != null;
		}

		// Must be set to `undefined` to properly clean up `_nextDom`
		// for which `null` is a valid value. See comment in `create-element.js`
		vnode._dom = vnode._nextDom = undefined;

		if ((r = vnode._component) != null) {
			if (r.componentWillUnmount) {
				try {
					r.componentWillUnmount();
				} catch (e) {
					options._catchError(e, parentVNode);
				}
			}

			r.base = r._parentDom = null;
		}

		if ((r = vnode._children)) {
			for (let i = 0; i < r.length; i++) {
				if (r[i]) unmount(r[i], parentVNode, skipRemove);
			}
		}

		if (dom != null) removeNode(dom);
	}

	/** The `.render()` method for a PFC backing instance. */
	function doRender(props, state, context) {
		return this.constructor(props, context);
	}

	/** @type {number} */
	let currentIndex;

	/** @type {import('./internal').Component} */
	let currentComponent;

	/** @type {number} */
	let currentHook = 0;

	/** @type {Array<import('./internal').Component>} */
	let afterPaintEffects = [];

	let oldBeforeRender = options._render;
	let oldAfterDiff = options.diffed;
	let oldCommit = options._commit;
	let oldBeforeUnmount = options.unmount;

	const RAF_TIMEOUT = 100;
	let prevRaf;

	options._render = vnode => {
		if (oldBeforeRender) oldBeforeRender(vnode);

		currentComponent = vnode._component;
		currentIndex = 0;

		if (currentComponent.__hooks) {
			currentComponent.__hooks._pendingEffects.forEach(invokeCleanup);
			currentComponent.__hooks._pendingEffects.forEach(invokeEffect);
			currentComponent.__hooks._pendingEffects = [];
		}
	};

	options.diffed = vnode => {
		if (oldAfterDiff) oldAfterDiff(vnode);

		const c = vnode._component;
		if (!c) return;

		const hooks = c.__hooks;
		if (hooks) {
			if (hooks._pendingEffects.length) {
				afterPaint(afterPaintEffects.push(c));
			}
		}
	};

	options._commit = (vnode, commitQueue) => {
		commitQueue.some(component => {
			try {
				component._renderCallbacks.forEach(invokeCleanup);
				component._renderCallbacks = component._renderCallbacks.filter(cb =>
					cb._value ? invokeEffect(cb) : true
				);
			} catch (e) {
				commitQueue.some(c => {
					if (c._renderCallbacks) c._renderCallbacks = [];
				});
				commitQueue = [];
				options._catchError(e, component._vnode);
			}
		});

		if (oldCommit) oldCommit(vnode, commitQueue);
	};

	options.unmount = vnode => {
		if (oldBeforeUnmount) oldBeforeUnmount(vnode);

		const c = vnode._component;
		if (!c) return;

		const hooks = c.__hooks;
		if (hooks) {
			try {
				hooks._list.forEach(hook => hook._cleanup && hook._cleanup());
			} catch (e) {
				options._catchError(e, c._vnode);
			}
		}
	};

	/**
	 * Get a hook's state from the currentComponent
	 * @param {number} index The index of the hook to get
	 * @param {number} type The index of the hook to get
	 * @returns {import('./internal').HookState}
	 */
	function getHookState(index, type) {
		if (options._hook) {
			options._hook(currentComponent, index, currentHook || type);
		}
		currentHook = 0;

		// Largely inspired by:
		// * https://github.com/michael-klein/funcy.js/blob/f6be73468e6ec46b0ff5aa3cc4c9baf72a29025a/src/hooks/core_hooks.mjs
		// * https://github.com/michael-klein/funcy.js/blob/650beaa58c43c33a74820a3c98b3c7079cf2e333/src/renderer.mjs
		// Other implementations to look at:
		// * https://codesandbox.io/s/mnox05qp8
		const hooks =
			currentComponent.__hooks ||
			(currentComponent.__hooks = {
				_list: [],
				_pendingEffects: []
			});

		if (index >= hooks._list.length) {
			hooks._list.push({});
		}
		return hooks._list[index];
	}

	/**
	 * @param {import('./index').StateUpdater<any>} initialState
	 */
	function useState(initialState) {
		currentHook = 1;
		return useReducer(invokeOrReturn, initialState);
	}

	/**
	 * @param {import('./index').Reducer<any, any>} reducer
	 * @param {import('./index').StateUpdater<any>} initialState
	 * @param {(initialState: any) => void} [init]
	 * @returns {[ any, (state: any) => void ]}
	 */
	function useReducer(reducer, initialState, init) {
		/** @type {import('./internal').ReducerHookState} */
		const hookState = getHookState(currentIndex++, 2);
		if (!hookState._component) {
			hookState._component = currentComponent;

			hookState._value = [
				!init ? invokeOrReturn(undefined, initialState) : init(initialState),

				action => {
					const nextValue = reducer(hookState._value[0], action);
					if (hookState._value[0] !== nextValue) {
						hookState._value[0] = nextValue;
						hookState._component.setState({});
					}
				}
			];
		}

		return hookState._value;
	}

	/**
	 * @param {() => any} factory
	 * @param {any[]} args
	 */
	function useMemo(factory, args) {
		/** @type {import('./internal').MemoHookState} */
		const state = getHookState(currentIndex++, 7);
		if (argsChanged(state._args, args)) {
			state._args = args;
			state._factory = factory;
			return (state._value = factory());
		}

		return state._value;
	}

	/**
	 * @param {() => void} callback
	 * @param {any[]} args
	 */
	function useCallback(callback, args) {
		currentHook = 8;
		return useMemo(() => callback, args);
	}

	/**
	 * After paint effects consumer.
	 */
	function flushAfterPaintEffects() {
		afterPaintEffects.some(component => {
			if (component._parentDom) {
				try {
					component.__hooks._pendingEffects.forEach(invokeCleanup);
					component.__hooks._pendingEffects.forEach(invokeEffect);
					component.__hooks._pendingEffects = [];
				} catch (e) {
					component.__hooks._pendingEffects = [];
					options._catchError(e, component._vnode);
					return true;
				}
			}
		});
		afterPaintEffects = [];
	}

	/**
	 * Schedule a callback to be invoked after the browser has a chance to paint a new frame.
	 * Do this by combining requestAnimationFrame (rAF) + setTimeout to invoke a callback after
	 * the next browser frame.
	 *
	 * Also, schedule a timeout in parallel to the the rAF to ensure the callback is invoked
	 * even if RAF doesn't fire (for example if the browser tab is not visible)
	 *
	 * @param {() => void} callback
	 */
	function afterNextFrame(callback) {
		const done = () => {
			clearTimeout(timeout);
			cancelAnimationFrame(raf);
			setTimeout(callback);
		};
		const timeout = setTimeout(done, RAF_TIMEOUT);

		let raf;
		if (typeof window != 'undefined') {
			raf = requestAnimationFrame(done);
		}
	}

	// Note: if someone used options.debounceRendering = requestAnimationFrame,
	// then effects will ALWAYS run on the NEXT frame instead of the current one, incurring a ~16ms delay.
	// Perhaps this is not such a big deal.
	/**
	 * Schedule afterPaintEffects flush after the browser paints
	 * @param {number} newQueueLength
	 */
	function afterPaint(newQueueLength) {
		if (newQueueLength === 1 || prevRaf !== options.requestAnimationFrame) {
			prevRaf = options.requestAnimationFrame;
			(prevRaf || afterNextFrame)(flushAfterPaintEffects);
		}
	}

	/**
	 * @param {import('./internal').EffectHookState} hook
	 */
	function invokeCleanup(hook) {
		if (hook._cleanup) hook._cleanup();
	}

	/**
	 * Invoke a Hook's effect
	 * @param {import('./internal').EffectHookState} hook
	 */
	function invokeEffect(hook) {
		const result = hook._value();
		if (typeof result == 'function') hook._cleanup = result;
	}

	/**
	 * @param {any[]} oldArgs
	 * @param {any[]} newArgs
	 */
	function argsChanged(oldArgs, newArgs) {
		return !oldArgs || newArgs.some((arg, index) => arg !== oldArgs[index]);
	}

	function invokeOrReturn(arg, f) {
		return typeof f == 'function' ? f(arg) : f;
	}

	const Counter = ({ start }) => {
	    const [value, setValue] = useState(start);
	    const increment = useCallback(() => {
	        setValue(value + 1);
	    }, [value]);
	    return (createElement("div", null,
	        "Counter: ",
	        value,
	        createElement("button", { onClick: increment }, "Increment")));
	};

	var App = ({ a, b, start }) => (createElement("div", { className: "mdp-preact" },
	    createElement("div", { className: "mdp-preact-body" },
	        "Preact Body ",
	        a,
	        ", ",
	        b,
	        createElement(Counter, { start: start }))));

	// DOM properties that should NOT have "px" added when numeric
	const IS_NON_DIMENSIONAL$1 = /acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|^--/i;

	let encodeEntities = s => String(s)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');

	let indent = (s, char) => String(s).replace(/(\n+)/g, '$1' + (char || '\t'));

	let isLargeString = (s, length, ignoreLines) => (String(s).length>(length || 40) || (!ignoreLines && String(s).indexOf('\n')!==-1) || String(s).indexOf('<')!==-1);

	const JS_TO_CSS = {};

	// Convert an Object style to a CSSText string
	function styleObjToCss(s) {
		let str = '';
		for (let prop in s) {
			let val = s[prop];
			if (val!=null) {
				if (str) str += ' ';
				// str += jsToCss(prop);
				str += JS_TO_CSS[prop] || (JS_TO_CSS[prop] = prop.replace(/([A-Z])/g,'-$1').toLowerCase());
				str += ': ';
				str += val;
				if (typeof val==='number' && IS_NON_DIMENSIONAL$1.test(prop)===false) {
					str += 'px';
				}
				str += ';';
			}
		}
		return str || undefined;
	}

	/**
	 * Copy all properties from `props` onto `obj`.
	 * @param {object} obj Object onto which properties should be copied.
	 * @param {object} props Object from which to copy properties.
	 * @returns {object}
	 * @private
	 */
	function assign$1(obj, props) {
		for (let i in props) obj[i] = props[i];
		return obj;
	}

	/**
	 * Get flattened children from the children prop
	 * @param {Array} accumulator
	 * @param {any} children A `props.children` opaque object.
	 * @returns {Array} accumulator
	 * @private
	 */
	function getChildren(accumulator, children) {
		if (Array.isArray(children)) {
			children.reduce(getChildren, accumulator);
		}
		else if (children!=null && children!==false) {
			accumulator.push(children);
		}
		return accumulator;
	}

	const SHALLOW = { shallow: true };

	// components without names, kept as a hash for later comparison to return consistent UnnamedComponentXX names.
	const UNNAMED = [];

	const VOID_ELEMENTS = /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/;

	const noop = () => {};


	/** Render Preact JSX + Components to an HTML string.
	 *	@name render
	 *	@function
	 *	@param {VNode} vnode	JSX VNode to render.
	 *	@param {Object} [context={}]	Optionally pass an initial context object through the render path.
	 *	@param {Object} [options={}]	Rendering options
	 *	@param {Boolean} [options.shallow=false]	If `true`, renders nested Components as HTML elements (`<Foo a="b" />`).
	 *	@param {Boolean} [options.xml=false]		If `true`, uses self-closing tags for elements without children.
	 *	@param {Boolean} [options.pretty=false]		If `true`, adds whitespace for readability
	 */
	renderToString.render = renderToString;


	/** Only render elements, leaving Components inline as `<ComponentName ... />`.
	 *	This method is just a convenience alias for `render(vnode, context, { shallow:true })`
	 *	@name shallow
	 *	@function
	 *	@param {VNode} vnode	JSX VNode to render.
	 *	@param {Object} [context={}]	Optionally pass an initial context object through the render path.
	 */
	let shallowRender = (vnode, context) => renderToString(vnode, context, SHALLOW);


	/** The default export is an alias of `render()`. */
	function renderToString(vnode, context, opts, inner, isSvgMode, selectValue) {
		if (vnode==null || typeof vnode==='boolean') {
			return '';
		}

		// wrap array nodes in Fragment
		if (Array.isArray(vnode)) {
			vnode = createElement(Fragment, null, vnode);
		}

		let nodeName = vnode.type,
			props = vnode.props,
			isComponent = false;
		context = context || {};
		opts = opts || {};

		let pretty = opts.pretty,
			indentChar = pretty && typeof pretty==='string' ? pretty : '\t';

		// #text nodes
		if (typeof vnode!=='object' && !nodeName) {
			return encodeEntities(vnode);
		}

		// components
		if (typeof nodeName==='function') {
			isComponent = true;
			if (opts.shallow && (inner || opts.renderRootComponent===false)) {
				nodeName = getComponentName(nodeName);
			}
			else if (nodeName===Fragment) {
				let rendered = '';
				let children = [];
				getChildren(children, vnode.props.children);

				for (let i = 0; i < children.length; i++) {
					rendered += (i > 0 && pretty ? '\n' : '') + renderToString(children[i], context, opts, opts.shallowHighOrder!==false, isSvgMode, selectValue);
				}
				return rendered;
			}
			else {
				let rendered;

				let c = vnode.__c = {
					__v: vnode,
					context,
					props: vnode.props,
					// silently drop state updates
					setState: noop,
					forceUpdate: noop,
					// hooks
					__h: []
				};

				// options.render
				if (options.__r) options.__r(vnode);

				if (!nodeName.prototype || typeof nodeName.prototype.render!=='function') {
					// Necessary for createContext api. Setting this property will pass
					// the context value as `this.context` just for this component.
					let cxType = nodeName.contextType;
					let provider = cxType && context[cxType.__c];
					let cctx = cxType != null ? (provider ? provider.props.value : cxType.__) : context;

					// stateless functional components
					rendered = nodeName.call(vnode.__c, props, cctx);
				}
				else {
					// class-based components
					let cxType = nodeName.contextType;
					let provider = cxType && context[cxType.__c];
					let cctx = cxType != null ? (provider ? provider.props.value : cxType.__) : context;

					// c = new nodeName(props, context);
					c = vnode.__c = new nodeName(props, cctx);
					c.__v = vnode;
					// turn off stateful re-rendering:
					c._dirty = c.__d = true;
					c.props = props;
					if (c.state==null) c.state = {};

					if (c._nextState==null && c.__s==null) {
						c._nextState = c.__s = c.state;
					}

					c.context = cctx;
					if (nodeName.getDerivedStateFromProps) c.state = assign$1(assign$1({}, c.state), nodeName.getDerivedStateFromProps(c.props, c.state));
					else if (c.componentWillMount) c.componentWillMount();

					// If the user called setState in cWM we need to flush pending,
					// state updates. This is the same behaviour in React.
					c.state = c._nextState !== c.state
						? c._nextState : c.__s!==c.state
							? c.__s : c.state;

					rendered = c.render(c.props, c.state, c.context);
				}

				if (c.getChildContext) {
					context = assign$1(assign$1({}, context), c.getChildContext());
				}

				return renderToString(rendered, context, opts, opts.shallowHighOrder!==false, isSvgMode, selectValue);
			}
		}

		// render JSX to HTML
		let s = '', html;

		if (props) {
			let attrs = Object.keys(props);

			// allow sorting lexicographically for more determinism (useful for tests, such as via preact-jsx-chai)
			if (opts && opts.sortAttributes===true) attrs.sort();

			for (let i=0; i<attrs.length; i++) {
				let name = attrs[i],
					v = props[name];
				if (name==='children') continue;

				if (name.match(/[\s\n\\/='"\0<>]/)) continue;

				if (!(opts && opts.allAttributes) && (name==='key' || name==='ref')) continue;

				if (name==='className') {
					if (props.class) continue;
					name = 'class';
				}
				else if (isSvgMode && name.match(/^xlink:?./)) {
					name = name.toLowerCase().replace(/^xlink:?/, 'xlink:');
				}

				if (name==='style' && v && typeof v==='object') {
					v = styleObjToCss(v);
				}

				let hooked = opts.attributeHook && opts.attributeHook(name, v, context, opts, isComponent);
				if (hooked || hooked==='') {
					s += hooked;
					continue;
				}

				if (name==='dangerouslySetInnerHTML') {
					html = v && v.__html;
				}
				else if ((v || v===0 || v==='') && typeof v!=='function') {
					if (v===true || v==='') {
						v = name;
						// in non-xml mode, allow boolean attributes
						if (!opts || !opts.xml) {
							s += ' ' + name;
							continue;
						}
					}

					if (name==='value') {
						if (nodeName==='select') {
							selectValue = v;
							continue;
						}
						else if (nodeName==='option' && selectValue==v) {
							s += ` selected`;
						}
					}
					s += ` ${name}="${encodeEntities(v)}"`;
				}
			}
		}

		// account for >1 multiline attribute
		if (pretty) {
			let sub = s.replace(/^\n\s*/, ' ');
			if (sub!==s && !~sub.indexOf('\n')) s = sub;
			else if (pretty && ~s.indexOf('\n')) s += '\n';
		}

		s = `<${nodeName}${s}>`;
		if (String(nodeName).match(/[\s\n\\/='"\0<>]/)) throw new Error(`${nodeName} is not a valid HTML tag name in ${s}`);

		let isVoid = String(nodeName).match(VOID_ELEMENTS);
		if (isVoid) s = s.replace(/>$/, ' />');

		let pieces = [];

		let children;
		if (html) {
			// if multiline, indent.
			if (pretty && isLargeString(html)) {
				html = '\n' + indentChar + indent(html, indentChar);
			}
			s += html;
		}
		else if (props && getChildren(children = [], props.children).length) {
			let hasLarge = pretty && ~s.indexOf('\n');
			let lastWasText = false;

			for (let i=0; i<children.length; i++) {
				let child = children[i];

				if (child!=null && child!==false) {
					let childSvgMode = nodeName==='svg' ? true : nodeName==='foreignObject' ? false : isSvgMode,
						ret = renderToString(child, context, opts, true, childSvgMode, selectValue);

					if (pretty && !hasLarge && isLargeString(ret)) hasLarge = true;

					// Skip if we received an empty string
					if (ret) {
						if (pretty) {
							let isText = ret.length > 0 && ret[0]!='<';
							
							// We merge adjacent text nodes, otherwise each piece would be printed
							// on a new line.
							if (lastWasText && isText) {
								pieces[pieces.length -1] += ret;
							}
							else {
								pieces.push(ret);
							}

							lastWasText = isText;
						}
						else {
							pieces.push(ret);
						}
					}
				}
			}
			if (pretty && hasLarge) {
				for (let i=pieces.length; i--; ) {
					pieces[i] = '\n' + indentChar + indent(pieces[i], indentChar);
				}
			}
		}

		if (pieces.length) {
			s += pieces.join('');
		}
		else if (opts && opts.xml) {
			return s.substring(0, s.length-1) + ' />';
		}

		if (!isVoid) {
			if (pretty && ~s.indexOf('\n')) s += '\n';
			s += `</${nodeName}>`;
		}

		return s;
	}

	function getComponentName(component) {
		return component.displayName || component!==Function && component.name || getFallbackComponentName(component);
	}

	function getFallbackComponentName(component) {
		let str = Function.prototype.toString.call(component),
			name = (str.match(/^\s*function\s+([^( ]+)/) || '')[1];
		if (!name) {
			// search for an existing indexed name for the given component:
			let index = -1;
			for (let i=UNNAMED.length; i--; ) {
				if (UNNAMED[i]===component) {
					index = i;
					break;
				}
			}
			// not found, create a new indexed name:
			if (index<0) {
				index = UNNAMED.push(component) - 1;
			}
			name = `UnnamedComponent${index}`;
		}
		return name;
	}
	renderToString.shallowRender = shallowRender;

	console.log(renderToString(App({ a: 'a', b: 'b', start: 5 })));

}());
