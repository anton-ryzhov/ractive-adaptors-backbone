/*

	Backbone adaptor plugin
	=======================

	Version 0.2.0. Copyright 2013 - 2014 @rich_harris, MIT licensed.

	This plugin allows Ractive.js to work seamlessly with Backbone.Model and
	Backbone.Collection instances.

	For more information see ractivejs.org/examples/backbone and
	https://github.com/Rich-Harris/Ractive/wiki/Adaptors.

	==========================

	Troubleshooting: If you're using a module system in your app (AMD or
	something more nodey) then you may need to change the paths below,
	where it says `require( 'ractive' )` or `define([ 'ractive' ]...)`.

	==========================

	Usage: Include this file on your page below Ractive, e.g:

	    <script src='lib/ractive.js'></script>
	    <script src='lib/ractive-adaptors-backbone.js'></script>

	Or, if you're using a module loader, require this module:

	    define( function ( require ) {
	      var Ractive = require( 'ractive' );

	      // requiring the plugin will 'activate' it - no need to use
	      // the return value
	      require( 'ractive-adaptors-backbone' );
	    });

	Then tell Ractive to expect Backbone objects by adding an `adapt` property:

	    var ractive = new Ractive({
	      el: myContainer,
	      template: myTemplate,
	      data: { foo: myBackboneModel, bar: myBackboneCollection },
	      adapt: [ 'Backbone' ]
	    });

*/

(function ( global, factory ) {

	'use strict';

	// Common JS (i.e. browserify) environment
	if ( typeof module !== 'undefined' && module.exports && typeof require === 'function' ) {
		factory( require( 'ractive' ), require( 'backbone' ) );
	}

	// AMD?
	else if ( typeof define === 'function' && define.amd ) {
		define([ 'ractive', 'backbone' ], factory );
	}

	// browser global
	else if ( global.Ractive && global.Backbone ) {
		factory( global.Ractive, global.Backbone );
	}

	else {
		throw new Error( 'Could not find Ractive or Backbone! Both must be loaded before the ractive-adaptors-backbone plugin' );
	}

}( typeof window !== 'undefined' ? window : this, function ( Ractive, Backbone ) {

	'use strict';

	var BackboneModelWrapper, BackboneCollectionWrapper;
	var lockProperty = '_ractiveAdaptorsBackboneLock';
	var originalSetProperty = '_ractiveAdaptorsBackboneOriginalSet';
	var BackboneCollectionWrapperChangeEvent = 'BackboneCollectionWrapper:change';

	var counter = window.counter = {
		model_change: 0,
		model_tear: 0,
		model_tryset: 0,
		model_set: 0,
		model_tryreset: 0,
		model_reset: 0,
		collection_change: 0,
		collection_tear: 0,
		collection_tryreset: 0,
		collection_tryreset2: 0,
		collection_reset: 0,
		collection_try_add: 0,
		collection_add: 0,
	};

	if ( !Ractive || !Backbone ) {
		throw new Error( 'Could not find Ractive or Backbone! Check your paths config' );
	}

	function acquireLock ( key, name ) {
		var namedLockProperty = lockProperty + ( name || '' );
		key[ namedLockProperty ] = ( key[ namedLockProperty ] || 0 ) + 1;
		return function release() {
			key[ namedLockProperty ] -= 1;
			if ( !key[ namedLockProperty ] ) {
				delete key[ namedLockProperty ];
			}
		};
	}

	function isLocked ( key, name ) {
		var namedLockProperty = lockProperty + ( name || '' );
		return !!key[ namedLockProperty ];
	}

	function onOff ( obj /* on/off() parameters */ ) {
		var onOffArgs = Array.prototype.slice.call( arguments, 1 );

		obj.on.apply( obj, onOffArgs );
		return function off () {
			obj.off.apply( obj, onOffArgs );
		};
	}

	Ractive.adaptors.Backbone = {
		filter: function ( object ) {
			return object instanceof Backbone.Model || object instanceof Backbone.Collection;
		},
		wrap: function ( ractive, object, keypath, prefix ) {
			if ( object instanceof Backbone.Model ) {
				return new BackboneModelWrapper( ractive, object, keypath, prefix );
			}

			return new BackboneCollectionWrapper( ractive, object, keypath, prefix );
		}
	};

	BackboneModelWrapper = function ( ractive, model, keypath, prefix ) {
		this.value = model;

		this.off = onOff( model, 'change', function () {
			counter.model_change++;
			var release = acquireLock( model, 'set' );
			ractive.set( prefix( model.changed ) );
			release();
		} );
	};

	BackboneModelWrapper.prototype = {
		teardown: function () {
			counter.model_tear++;
			this.off();
			this.value.off( 'change', this.modelChangeHandler );
		},
		get: function () {
			return this.value.attributes;
		},
		set: function ( keypath, value ) {
			// Only set if the model didn't originate the change itself, and
			// only if it's an immediate child property
			counter.model_tryset++;
			if ( !isLocked( this.value, 'set' ) && keypath.indexOf( '.' ) === -1 ) {
				counter.model_set++;
				this.value.set( keypath, value );
			}
		},
		reset: function ( object ) {
			// If the new object is a Backbone model, assume this one is
			// being retired. Ditto if it's not a model at all
			counter.model_tryreset++;
			if ( object instanceof Backbone.Model || !(object instanceof Object) ) {
				return false;
			}
			counter.model_reset++;

			// Otherwise if this is a POJO, reset the model
			//Backbone 1.1.2 no longer has reset and just uses set
			this.value.set( object );
		}
	};

	BackboneCollectionWrapper = function ( ractive, collection, keypath ) {
		this.value = collection;

		function changeHandler () {
			counter.collection_try_add++;
			if ( isLocked( collection, 'setSuccess' ) ) {
				return;
			};
			counter.collection_add++;

			// TODO smart merge. It should be possible, if awkward, to trigger smart
			// updates instead of a blunderbuss .set() approach
			var release = acquireLock( collection, 'set' );
			ractive.set( keypath, collection.models );
			release();
		}
		this.off = onOff( collection, 'add remove reset sort ' + BackboneCollectionWrapperChangeEvent, changeHandler );

		if ( !collection.hasOwnProperty( originalSetProperty ) ) {
			// Patch set method if not patched
			var originalSet = collection.set;
			collection[ originalSetProperty ] = collection.hasOwnProperty('set') ? originalSet : null;

			collection.set = function ractivePatchedSet() {
				var release = acquireLock( collection, 'setSuccess' );
				var result = originalSet.apply( this, arguments );
				release();

				// Notify all `BackboneCollectionWrapper`s about change
				collection.trigger( BackboneCollectionWrapperChangeEvent );
				return result;
			};
		}
		this.releaseSetPatch = acquireLock( collection, 'setPatch' );	// Count patch users
	};

	BackboneCollectionWrapper.prototype = {
		teardown: function () {
			var collection = this.value;

			this.releaseSetPatch();
			if ( !isLocked( collection, 'setPatch' ) ) {
				// Cleanup, return original set
				if ( collection[ originalSetProperty ] ) {
					// We had object-owned method
					collection.set = collection[ originalSetProperty ];
					delete collection[ originalSetProperty ];
				} else {
					// Use prototype method
					delete collection.set;
				}
			}

			counter.collection_tear++;
			this.off();
		},
		get: function () {
			return this.value.models;
		},
		reset: function ( models ) {
			counter.collection_tryreset++;
			if ( isLocked( this.value, 'set' ) ) {
				return;
			}
			counter.collection_tryreset2++;

			// If the new object is a Backbone collection, assume this one is
			// being retired. Ditto if it's not a collection at all
			if ( models instanceof Backbone.Collection || Object.prototype.toString.call( models ) !== '[object Array]' ) {
				return false;
			}
			counter.collection_reset++;

			// Otherwise if this is a plain array, reset the collection
			this.value.reset( models );
		}
	};

}));
