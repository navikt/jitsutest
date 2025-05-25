const path = require("path");
const webpack = require("webpack");

const config = {
  entry: "./src/index.ts",
  target: "node",
  externals: {
    "../package.json": "require('../package.json')",
  },
  node: {
    __dirname: false,
  },
  devtool: "source-map",
  output: {
    path: path.resolve(__dirname, "dist"),
  },
  plugins: [
    new webpack.IgnorePlugin({ resourceRegExp: /^fsevents$/ }), // Ignore MacOS-only module
  ],
  module: {
    rules: [
      {
        test: /\.(ts|tsx)$/i,
        use: {
          loader: "babel-loader",
        },
      },
      {
        test: /\.node$/,
        loader: "node-loader",
      },
    ],
  },
  optimization: {
    minimize: false,
  },
  resolve: {
    extensions: [".tsx", ".ts", ".jsx", ".js", ".node", "..."],
  },
  mode: "production",
};

module.exports = () => config;
