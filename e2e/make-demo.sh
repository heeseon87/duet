#!/bin/bash
# Builds a small demo repo for Duet's review screens: a branch with commits, plus uncommitted work.
set -e
R="$1"
if [ -e "$R" ]; then echo "already exists: $R"; exit 1; fi
mkdir -p "$R/src/worker" "$R/src/source" "$R/docs"
cd "$R"
git init -q -b main
G() { git -c user.email=demo@duet -c user.name=demo "$@"; }

cat > src/worker/ThumbnailWorker.kt <<'EOF'
package demo.worker

import demo.source.SourceResolver
import java.nio.file.Path

class ThumbnailWorker(
    private val resolver: SourceResolver,
    private val ffmpeg: FfmpegCli,
) {
    fun handle(bucket: String, path: String): Result {
        val source = resolver.resolve(bucket, path) ?: return Result.Invalid
        val workDir = Path.of("/tmp", source.swingId)
        val video = ffmpeg.download(source, workDir)
        val thumbnail = ffmpeg.encode(video, workDir.resolve("thumb.mp4"))
        return Result.Done(thumbnail)
    }

    sealed interface Result {
        data object Invalid : Result
        data class Done(val file: Path) : Result
    }
}
EOF
cat > src/source/SourceResolver.kt <<'EOF'
package demo.source

data class Source(val bucket: String, val userId: String, val swingId: String)

class SourceResolver(private val buckets: Set<String>) {
    fun resolve(bucket: String, path: String): Source? {
        if (bucket !in buckets) return null
        val parts = path.split("/")
        if (parts.size < 3) return null
        return Source(bucket, parts[0], parts[1])
    }
}
EOF
printf '# Demo\n\nA small worker that makes swing thumbnails.\n' > README.md
printf 'old notes\n' > docs/old.md
git add -A
G commit -qm 'initial worker'
git checkout -qb feature/split-ffmpeg

python3 - <<'EOF'
p = 'src/worker/ThumbnailWorker.kt'
s = open(p).read()
s = s.replace('''    private val ffmpeg: FfmpegCli,
) {''', '''    private val fetcher: VideoFetcher,
    private val generator: ThumbnailGenerator,
) {''')
s = s.replace('''        val workDir = Path.of("/tmp", source.swingId)
        val video = ffmpeg.download(source, workDir)
        val thumbnail = ffmpeg.encode(video, workDir.resolve("thumb.mp4"))
        return Result.Done(thumbnail)''', '''        val workDir = Path.of(System.getProperty("java.io.tmpdir"), "thumb-${source.swingId}")
        try {
            val video = fetcher.fetch(source, workDir) ?: return Result.VideoMissing
            val thumbnail = generator.generate(video, workDir)
            return Result.Done(thumbnail)
        } finally {
            workDir.toFile().deleteRecursively()
        }''')
s = s.replace('''        data object Invalid : Result''', '''        data object Invalid : Result
        data object VideoMissing : Result''')
open(p, 'w').write(s)
EOF
G commit -qam 'split fetch and generate'

cat > src/worker/ThumbnailGenerator.kt <<'EOF'
package demo.worker

import java.nio.file.Path

/** Encodes the swing video into a short, small thumbnail clip. */
class ThumbnailGenerator(private val ffmpeg: FfmpegCli) {
    fun generate(video: Path, workDir: Path): Path {
        val out = workDir.resolve("thumbnail-swing-video.mp4")
        ffmpeg.run(listOf("-i", video.toString(), "-an", "-r", "15", "-crf", "32", out.toString()))
        return out
    }
}
EOF
python3 - <<'EOF'
p = 'README.md'
s = open(p).read()
s = s.replace('A small worker that makes swing thumbnails.', 'A small worker that makes swing thumbnails.\n\n## Flow\n\n1. Resolve the source from the bucket event.\n2. Fetch the video.\n3. Generate the thumbnail.')
open(p, 'w').write(s)
EOF
git rm -q docs/old.md
git log --oneline
git status --short
