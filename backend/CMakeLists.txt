cmake_minimum_required(VERSION 3.16)
project(spotwhere_backend CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# libpq (Postgres C client) — keg-only в Homebrew, подсказываем путь
set(PostgreSQL_ROOT "/opt/homebrew/opt/libpq")

find_package(Drogon CONFIG REQUIRED)
find_package(PostgreSQL REQUIRED)
find_package(CURL REQUIRED)

add_executable(spotwhere_backend main.cpp)
target_link_libraries(spotwhere_backend PRIVATE Drogon::Drogon PostgreSQL::PostgreSQL CURL::libcurl)
