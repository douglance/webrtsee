/*eslint-disable block-scoped-var, id-length, no-control-regex, no-magic-numbers, no-prototype-builtins, no-redeclare, no-shadow, no-var, sort-vars*/
import * as $protobuf from "protobufjs/minimal";

// Common aliases
const $Reader = $protobuf.Reader, $Writer = $protobuf.Writer, $util = $protobuf.util;

// Exported root namespace
const $root = $protobuf.roots["default"] || ($protobuf.roots["default"] = {});

/**
 * MessageType enum.
 * @exports MessageType
 * @enum {number}
 * @property {number} AVATAR_POSE=0 AVATAR_POSE value
 * @property {number} SCREEN_POSE=1 SCREEN_POSE value
 */
export const MessageType = $root.MessageType = (() => {
    const valuesById = {}, values = Object.create(valuesById);
    values[valuesById[0] = "AVATAR_POSE"] = 0;
    values[valuesById[1] = "SCREEN_POSE"] = 1;
    return values;
})();

export const PoseMessage = $root.PoseMessage = (() => {

    /**
     * Properties of a PoseMessage.
     * @exports IPoseMessage
     * @interface IPoseMessage
     * @property {MessageType|null} [type] PoseMessage type
     * @property {number|null} [x] PoseMessage x
     * @property {number|null} [y] PoseMessage y
     * @property {number|null} [z] PoseMessage z
     * @property {number|null} [yaw] PoseMessage yaw
     * @property {number|null} [pitch] PoseMessage pitch
     * @property {number|null} [flags] PoseMessage flags
     * @property {number|null} [timestamp] PoseMessage timestamp
     */

    /**
     * Constructs a new PoseMessage.
     * @exports PoseMessage
     * @classdesc Represents a PoseMessage.
     * @implements IPoseMessage
     * @constructor
     * @param {IPoseMessage=} [properties] Properties to set
     */
    function PoseMessage(properties) {
        if (properties)
            for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * PoseMessage type.
     * @member {MessageType} type
     * @memberof PoseMessage
     * @instance
     */
    PoseMessage.prototype.type = 0;

    /**
     * PoseMessage x.
     * @member {number} x
     * @memberof PoseMessage
     * @instance
     */
    PoseMessage.prototype.x = 0;

    /**
     * PoseMessage y.
     * @member {number} y
     * @memberof PoseMessage
     * @instance
     */
    PoseMessage.prototype.y = 0;

    /**
     * PoseMessage z.
     * @member {number} z
     * @memberof PoseMessage
     * @instance
     */
    PoseMessage.prototype.z = 0;

    /**
     * PoseMessage yaw.
     * @member {number} yaw
     * @memberof PoseMessage
     * @instance
     */
    PoseMessage.prototype.yaw = 0;

    /**
     * PoseMessage pitch.
     * @member {number} pitch
     * @memberof PoseMessage
     * @instance
     */
    PoseMessage.prototype.pitch = 0;

    /**
     * PoseMessage flags.
     * @member {number} flags
     * @memberof PoseMessage
     * @instance
     */
    PoseMessage.prototype.flags = 0;

    /**
     * PoseMessage timestamp.
     * @member {number} timestamp
     * @memberof PoseMessage
     * @instance
     */
    PoseMessage.prototype.timestamp = 0;

    /**
     * Creates a new PoseMessage instance using the specified properties.
     * @function create
     * @memberof PoseMessage
     * @static
     * @param {IPoseMessage=} [properties] Properties to set
     * @returns {PoseMessage} PoseMessage instance
     */
    PoseMessage.create = function create(properties) {
        return new PoseMessage(properties);
    };

    /**
     * Encodes the specified PoseMessage message. Does not implicitly {@link PoseMessage.verify|verify} messages.
     * @function encode
     * @memberof PoseMessage
     * @static
     * @param {IPoseMessage} message PoseMessage message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    PoseMessage.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        if (message.type != null && Object.hasOwnProperty.call(message, "type"))
            writer.uint32(/* id 1, wireType 0 =*/8).int32(message.type);
        if (message.x != null && Object.hasOwnProperty.call(message, "x"))
            writer.uint32(/* id 2, wireType 5 =*/21).float(message.x);
        if (message.y != null && Object.hasOwnProperty.call(message, "y"))
            writer.uint32(/* id 3, wireType 5 =*/29).float(message.y);
        if (message.z != null && Object.hasOwnProperty.call(message, "z"))
            writer.uint32(/* id 4, wireType 5 =*/37).float(message.z);
        if (message.yaw != null && Object.hasOwnProperty.call(message, "yaw"))
            writer.uint32(/* id 5, wireType 5 =*/45).float(message.yaw);
        if (message.pitch != null && Object.hasOwnProperty.call(message, "pitch"))
            writer.uint32(/* id 6, wireType 5 =*/53).float(message.pitch);
        if (message.flags != null && Object.hasOwnProperty.call(message, "flags"))
            writer.uint32(/* id 7, wireType 0 =*/56).uint32(message.flags);
        if (message.timestamp != null && Object.hasOwnProperty.call(message, "timestamp"))
            writer.uint32(/* id 8, wireType 0 =*/64).uint32(message.timestamp);
        return writer;
    };

    /**
     * Encodes the specified PoseMessage message, length delimited. Does not implicitly {@link PoseMessage.verify|verify} messages.
     * @function encodeDelimited
     * @memberof PoseMessage
     * @static
     * @param {IPoseMessage} message PoseMessage message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    PoseMessage.encodeDelimited = function encodeDelimited(message, writer) {
        return this.encode(message, writer).ldelim();
    };

    /**
     * Decodes a PoseMessage message from the specified reader or buffer.
     * @function decode
     * @memberof PoseMessage
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {PoseMessage} PoseMessage
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    PoseMessage.decode = function decode(reader, length, error) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        let end = length === undefined ? reader.len : reader.pos + length, message = new $root.PoseMessage();
        while (reader.pos < end) {
            let tag = reader.uint32();
            if (tag === error)
                break;
            switch (tag >>> 3) {
            case 1: {
                    message.type = reader.int32();
                    break;
                }
            case 2: {
                    message.x = reader.float();
                    break;
                }
            case 3: {
                    message.y = reader.float();
                    break;
                }
            case 4: {
                    message.z = reader.float();
                    break;
                }
            case 5: {
                    message.yaw = reader.float();
                    break;
                }
            case 6: {
                    message.pitch = reader.float();
                    break;
                }
            case 7: {
                    message.flags = reader.uint32();
                    break;
                }
            case 8: {
                    message.timestamp = reader.uint32();
                    break;
                }
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        return message;
    };

    /**
     * Decodes a PoseMessage message from the specified reader or buffer, length delimited.
     * @function decodeDelimited
     * @memberof PoseMessage
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @returns {PoseMessage} PoseMessage
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    PoseMessage.decodeDelimited = function decodeDelimited(reader) {
        if (!(reader instanceof $Reader))
            reader = new $Reader(reader);
        return this.decode(reader, reader.uint32());
    };

    /**
     * Verifies a PoseMessage message.
     * @function verify
     * @memberof PoseMessage
     * @static
     * @param {Object.<string,*>} message Plain object to verify
     * @returns {string|null} `null` if valid, otherwise the reason why it is not
     */
    PoseMessage.verify = function verify(message) {
        if (typeof message !== "object" || message === null)
            return "object expected";
        if (message.type != null && message.hasOwnProperty("type"))
            switch (message.type) {
            default:
                return "type: enum value expected";
            case 0:
            case 1:
                break;
            }
        if (message.x != null && message.hasOwnProperty("x"))
            if (typeof message.x !== "number")
                return "x: number expected";
        if (message.y != null && message.hasOwnProperty("y"))
            if (typeof message.y !== "number")
                return "y: number expected";
        if (message.z != null && message.hasOwnProperty("z"))
            if (typeof message.z !== "number")
                return "z: number expected";
        if (message.yaw != null && message.hasOwnProperty("yaw"))
            if (typeof message.yaw !== "number")
                return "yaw: number expected";
        if (message.pitch != null && message.hasOwnProperty("pitch"))
            if (typeof message.pitch !== "number")
                return "pitch: number expected";
        if (message.flags != null && message.hasOwnProperty("flags"))
            if (!$util.isInteger(message.flags))
                return "flags: integer expected";
        if (message.timestamp != null && message.hasOwnProperty("timestamp"))
            if (!$util.isInteger(message.timestamp))
                return "timestamp: integer expected";
        return null;
    };

    /**
     * Creates a PoseMessage message from a plain object. Also converts values to their respective internal types.
     * @function fromObject
     * @memberof PoseMessage
     * @static
     * @param {Object.<string,*>} object Plain object
     * @returns {PoseMessage} PoseMessage
     */
    PoseMessage.fromObject = function fromObject(object) {
        if (object instanceof $root.PoseMessage)
            return object;
        let message = new $root.PoseMessage();
        switch (object.type) {
        default:
            if (typeof object.type === "number") {
                message.type = object.type;
                break;
            }
            break;
        case "AVATAR_POSE":
        case 0:
            message.type = 0;
            break;
        case "SCREEN_POSE":
        case 1:
            message.type = 1;
            break;
        }
        if (object.x != null)
            message.x = Number(object.x);
        if (object.y != null)
            message.y = Number(object.y);
        if (object.z != null)
            message.z = Number(object.z);
        if (object.yaw != null)
            message.yaw = Number(object.yaw);
        if (object.pitch != null)
            message.pitch = Number(object.pitch);
        if (object.flags != null)
            message.flags = object.flags >>> 0;
        if (object.timestamp != null)
            message.timestamp = object.timestamp >>> 0;
        return message;
    };

    /**
     * Creates a plain object from a PoseMessage message. Also converts values to other types if specified.
     * @function toObject
     * @memberof PoseMessage
     * @static
     * @param {PoseMessage} message PoseMessage
     * @param {$protobuf.IConversionOptions} [options] Conversion options
     * @returns {Object.<string,*>} Plain object
     */
    PoseMessage.toObject = function toObject(message, options) {
        if (!options)
            options = {};
        let object = {};
        if (options.defaults) {
            object.type = options.enums === String ? "AVATAR_POSE" : 0;
            object.x = 0;
            object.y = 0;
            object.z = 0;
            object.yaw = 0;
            object.pitch = 0;
            object.flags = 0;
            object.timestamp = 0;
        }
        if (message.type != null && message.hasOwnProperty("type"))
            object.type = options.enums === String ? $root.MessageType[message.type] === undefined ? message.type : $root.MessageType[message.type] : message.type;
        if (message.x != null && message.hasOwnProperty("x"))
            object.x = options.json && !isFinite(message.x) ? String(message.x) : message.x;
        if (message.y != null && message.hasOwnProperty("y"))
            object.y = options.json && !isFinite(message.y) ? String(message.y) : message.y;
        if (message.z != null && message.hasOwnProperty("z"))
            object.z = options.json && !isFinite(message.z) ? String(message.z) : message.z;
        if (message.yaw != null && message.hasOwnProperty("yaw"))
            object.yaw = options.json && !isFinite(message.yaw) ? String(message.yaw) : message.yaw;
        if (message.pitch != null && message.hasOwnProperty("pitch"))
            object.pitch = options.json && !isFinite(message.pitch) ? String(message.pitch) : message.pitch;
        if (message.flags != null && message.hasOwnProperty("flags"))
            object.flags = message.flags;
        if (message.timestamp != null && message.hasOwnProperty("timestamp"))
            object.timestamp = message.timestamp;
        return object;
    };

    /**
     * Converts this PoseMessage to JSON.
     * @function toJSON
     * @memberof PoseMessage
     * @instance
     * @returns {Object.<string,*>} JSON object
     */
    PoseMessage.prototype.toJSON = function toJSON() {
        return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
    };

    /**
     * Gets the default type url for PoseMessage
     * @function getTypeUrl
     * @memberof PoseMessage
     * @static
     * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
     * @returns {string} The default type url
     */
    PoseMessage.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
        if (typeUrlPrefix === undefined) {
            typeUrlPrefix = "type.googleapis.com";
        }
        return typeUrlPrefix + "/PoseMessage";
    };

    return PoseMessage;
})();

export { $root as default };
