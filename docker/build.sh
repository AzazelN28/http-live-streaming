function retrieve_script_path() {
    # Retrieve the directory of the script
    SELF_PATH=$(cd -P -- "$(dirname -- "$0")" && pwd -P) && SELF_PATH=$SELF_PATH/$(basename -- "$0")

    # resolve symlinks
    while [[ -h $SELF_PATH ]]; do
        DIR=$(dirname -- "$SELF_PATH")
        SYM=$(readlink "$SELF_PATH")
        SELF_PATH=$(cd "$DIR" && cd "$(dirname -- "$SYM")" && pwd)/$(basename -- "$SYM")
    done

    DIR=$(dirname -- "$SELF_PATH")
}

retrieve_script_path

docker build -t sq/bento $DIR
