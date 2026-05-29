/* eslint-disable */

// Zotero global API declarations
declare const Zotero: {
  log(msg: string): void;
  [key: string]: any;
};

// Mozilla Services API
declare const Services: {
  io: {
    newURI(uri: string): any;
    newChannel(uri: string): any;
  };
  ios: {
    getProtocolHandler(protocol: string): any;
  };
  [key: string]: any;
};
